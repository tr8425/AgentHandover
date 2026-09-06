import { execSync, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SubagentMeta } from '../scanner/index.js'

export interface AgentPattern {
  name: string
  description: string
  sessionCount: number
  totalBytes: number
  confidence: 'high' | 'medium' | 'low'
  representativeDescriptions: string[]
  suggestedDirectories: string[]
}

export interface AnalysisResult {
  patterns: AgentPattern[]
  skippedCount: number
  rawSummary: string
}

const KEYWORD_RULES: Record<string, RegExp> = {
  'seo':          /seo|meta.?tag|hreflang|sitemap|robots|canonical|noindex/i,
  'geo':          /geo|citation|json.?ld|structured.?data|ai.?search|perplexity/i,
  'frontend':     /frontend|fe|component|landing|pricing|modal|ui|button|form|page/i,
  'backend':      /backend|be|api|nestjs|controller|service|dto|migration|fastapi/i,
  'code-review':  /review|리뷰|코드.*분석|analyze.*code|check.*code|quality/i,
  'explore':      /explore|탐색|조사|find|search|look.*for|어디/i,
  'debug':        /debug|버그|bug|error|fix|오류|문제/i,
  'i18n':         /i18n|번역|translation|locale|다국어|language/i,
  'content':      /blog|콘텐츠|content|초안|draft|keyword|writer/i,
  'docs':         /doc|문서|가이드|guide|readme|docusaurus/i,
  'infra':        /infra|deploy|docker|terraform|lambda|build|config/i,
  'test':         /test|테스트|spec|jest|vitest|coverage/i,
}

interface LocalGroup {
  keyword: string
  count: number
  totalBytes: number
  samples: string[]
}

function localGrouping(subagents: SubagentMeta[]): LocalGroup[] {
  const groups: Record<string, LocalGroup> = {}

  for (const s of subagents) {
    const desc = s.description.toLowerCase()
    let matched = false

    for (const [key, pattern] of Object.entries(KEYWORD_RULES)) {
      if (pattern.test(desc)) {
        if (!groups[key]) groups[key] = { keyword: key, count: 0, totalBytes: 0, samples: [] }
        groups[key].count++
        groups[key].totalBytes += s.jsonlSizeBytes
        if (groups[key].samples.length < 5) groups[key].samples.push(s.description.slice(0, 80))
        matched = true
        break
      }
    }

    if (!matched) {
      if (!groups['other']) groups['other'] = { keyword: 'other', count: 0, totalBytes: 0, samples: [] }
      groups['other'].count++
      groups['other'].totalBytes += s.jsonlSizeBytes
      if (groups['other'].samples.length < 5) groups['other'].samples.push(s.description.slice(0, 80))
    }
  }

  return Object.values(groups).sort((a, b) => b.count - a.count)
}

const SYSTEM_PROMPT = `You are finalizing Claude Code agent candidates from pre-grouped session data.

Rules:
- confidence: high = 15+ sessions, medium = 7-14, low = 3-6, skip = under 3
- Suggest specific kebab-case agent names
- description must include "Use proactively" or "Make sure to use this whenever"
- Return ONLY valid JSON, no markdown fences

Output format:
{"patterns":[{"name":"seo-expert","description":"...Use proactively...","sessionCount":47,"totalBytes":3200000,"confidence":"high","representativeDescriptions":["sample1"],"suggestedDirectories":["web/"]}],"skippedCount":2,"rawSummary":"Found N patterns"}`

export async function analyzePatterns(
  subagents: SubagentMeta[],
  livePaths: string[],
  _apiKey: string
): Promise<AnalysisResult> {
  const builtinOnly = subagents.filter(s =>
    ['Explore', 'general-purpose', 'Plan', ''].includes(s.agentType)
  )

  const groups = localGrouping(builtinOnly)

  const fullPrompt = SYSTEM_PROMPT + '\n\nPre-grouped data (' + builtinOnly.length + ' total):\n' +
    JSON.stringify(groups, null, 2) +
    '\n\nLive git paths:\n' +
    (livePaths.slice(0, 20).join('\n') || '(not a git repo)')

  // 프롬프트를 임시 파일로 저장 → stdin으로 전달 (쉘 인자 길이 제한 우회)
  const tmpFile = path.join(os.tmpdir(), 'agent-cli-prompt.txt')
  fs.writeFileSync(tmpFile, fullPrompt, 'utf-8')

  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.ANTHROPIC_API_KEY

  const result = spawnSync(
    'claude',
    ['-p', fullPrompt, '--output-format', 'json'],
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 120000, env }
  )

  fs.unlinkSync(tmpFile)

  if (result.error) throw new Error('claude 실행 실패: ' + result.error.message)
  if (result.status !== 0) throw new Error('claude 오류:\n' + (result.stderr || '').slice(0, 300))

  const raw = result.stdout
  let text: string
  try {
    const parsed = JSON.parse(raw)
    text = parsed.result ?? raw
  } catch {
    text = raw
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('파싱 실패:\n' + text.slice(0, 300))

  return JSON.parse(jsonMatch[0]) as AnalysisResult
}
