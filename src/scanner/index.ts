import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'

export interface SubagentMeta {
  project: string
  session: string
  agentType: string
  description: string
  jsonlSizeBytes: number
  sessionDate: string
}

export interface ScanResult {
  totalSessions: number
  totalSubagents: number
  subagents: SubagentMeta[]
  gitCommitPaths: string[]   // 현재 HEAD에 실제 존재하는 경로들
  claudeDir: string
}

export function detectClaudeDir(): string {
  const candidates = [
    path.join(os.homedir(), '.claude'),
    path.join('/mnt/c', os.userInfo().username, '.claude'), // WSL
  ]
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'projects'))) return c
  }
  throw new Error('~/.claude/projects/ 를 찾을 수 없습니다. Claude Code가 설치되어 있는지 확인하세요.')
}

export function scanSessions(claudeDir: string, projectFilter?: string): ScanResult {
  const projectsDir = path.join(claudeDir, 'projects')
  const projects = fs.readdirSync(projectsDir).filter(p =>
    fs.statSync(path.join(projectsDir, p)).isDirectory()
  )

  const subagents: SubagentMeta[] = []
  let totalSessions = 0

  for (const proj of projects) {
    if (projectFilter && !proj.includes(projectFilter)) continue
    const projDir = path.join(projectsDir, proj)

    const entries = fs.readdirSync(projDir)
    const sessionIds = entries
      .filter(e => /^[0-9a-f]{8}-/.test(e) && e.endsWith('.jsonl'))
      .map(e => e.replace('.jsonl', ''))

    totalSessions += sessionIds.length

    for (const sessionId of sessionIds) {
      const subagentDir = path.join(projDir, sessionId, 'subagents')
      if (!fs.existsSync(subagentDir)) continue

      const sessionJsonl = path.join(projDir, `${sessionId}.jsonl`)
      const sessionDate = extractSessionDate(sessionJsonl)

      const metaFiles = fs.readdirSync(subagentDir).filter(f => f.endsWith('.meta.json'))
      for (const metaFile of metaFiles) {
        const metaPath = path.join(subagentDir, metaFile)
        const jsonlPath = metaPath.replace('.meta.json', '.jsonl')

        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          let description = meta.description || ''

          // description 누락 시 세션 첫 메시지로 보완
          if (!description && fs.existsSync(sessionJsonl)) {
            description = extractFirstMessage(sessionJsonl)
          }

          const jsonlSize = fs.existsSync(jsonlPath)
            ? fs.statSync(jsonlPath).size
            : 0

          subagents.push({
            project: proj,
            session: sessionId,
            agentType: meta.agentType || '',
            description,
            jsonlSizeBytes: jsonlSize,
            sessionDate,
          })
        } catch {
          // 파싱 실패 시 스킵
        }
      }
    }
  }

  // 현재 Git HEAD 경로 검증
  const gitCommitPaths = detectLiveGitPaths()

  return {
    totalSessions,
    totalSubagents: subagents.length,
    subagents,
    gitCommitPaths,
    claudeDir,
  }
}

function extractSessionDate(jsonlPath: string): string {
  if (!fs.existsSync(jsonlPath)) return ''
  try {
    const firstLine = fs.readFileSync(jsonlPath, 'utf-8').split('\n')[0]
    const parsed = JSON.parse(firstLine)
    return (parsed.timestamp || '').slice(0, 10)
  } catch {
    return ''
  }
}

function extractFirstMessage(jsonlPath: string): string {
  try {
    const lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      const parsed = JSON.parse(line)
      if (parsed?.message?.role === 'user') {
        const content = parsed.message.content
        if (typeof content === 'string') return content.slice(0, 100)
        if (Array.isArray(content)) {
          return content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join(' ')
            .slice(0, 100)
        }
      }
    }
  } catch {}
  return ''
}

function detectLiveGitPaths(): string[] {
  try {
    const output = execSync('git ls-files', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // 디렉토리 레벨로 추출
    const dirs = new Set<string>()
    for (const file of output.split('\n').filter(Boolean)) {
      const parts = file.split('/')
      if (parts.length > 1) dirs.add(parts[0])
      // 2단계까지
      if (parts.length > 2) dirs.add(`${parts[0]}/${parts[1]}`)
    }
    return [...dirs]
  } catch {
    return [] // git repo 아닌 경우 빈 배열
  }
}
