import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { AgentPattern } from '../analyzer/index.js'

export interface GeneratedAgent {
  name: string
  content: string
}

const SYSTEM_PROMPT = [
  'You generate Claude Code custom agent .md files.',
  '',
  'Rules:',
  '- Output ONLY the raw markdown content. No explanation, no code fences.',
  '- frontmatter must include: name, description, tools, memory: project',
  '- description must be pushy: include "Use proactively" or "Make sure to use this whenever..."',
  '- Body sections (in Korean): 역할 (1 sentence), 워크플로우 (numbered list), 핵심 지식, 성공 기준, 제약, Gotchas (empty placeholder)',
  '- Keep instruction part under 200 words',
].join('\n')

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env }
    delete env.ANTHROPIC_API_KEY

    const child = spawn('claude', ['-p', prompt, '--output-format', 'json'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('claude 타임아웃 (3분)'))
    }, 180000)

    child.on('close', (code: number) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(stderr.slice(0, 300)))
      else resolve(stdout)
    })
  })
}

export async function generateAgentFile(pattern: AgentPattern, _apiKey: string): Promise<GeneratedAgent> {
  const fullPrompt = SYSTEM_PROMPT + '\n\nGenerate agent file for:\n' + JSON.stringify(pattern, null, 2)
  const raw = await runClaude(fullPrompt)

  let content: string
  try {
    const parsed = JSON.parse(raw)
    content = parsed.result ?? raw
  } catch {
    content = raw
  }

  return { name: pattern.name, content: content.trim() }
}

export function writeAgentFile(agent: GeneratedAgent, outputDir: string): string {
  const agentsDir = path.join(outputDir, '.claude', 'agents')
  fs.mkdirSync(agentsDir, { recursive: true })
  const filePath = path.join(agentsDir, agent.name + '.md')
  fs.writeFileSync(filePath, agent.content, 'utf-8')
  return filePath
}
