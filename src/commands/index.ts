import { Command } from 'commander'
import inquirer from 'inquirer'
import ora from 'ora'
import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { detectClaudeDir, scanSessions } from '../scanner/index.js'
import { analyzePatterns, AnalysisResult, AgentPattern } from '../analyzer/index.js'
import { generateAgentFile, writeAgentFile } from '../generator/index.js'
import { loadConfig, saveConfig, getCacheDir } from '../config.js'

function today(): string { return new Date().toISOString().slice(0, 10) }

function confidenceBadge(c: string): string {
  if (c === 'high') return chalk.green('●')
  if (c === 'medium') return chalk.yellow('●')
  return chalk.dim('●')
}

function formatBytes(bytes: number): string {
  if (bytes > 1_000_000) return (bytes / 1_000_000).toFixed(1) + 'MB'
  if (bytes > 1_000) return (bytes / 1_000).toFixed(0) + 'KB'
  return bytes + 'B'
}

function printAnalysisResult(result: AnalysisResult) {
  console.log(chalk.bold('\n  발견된 패턴:\n'))
  for (const p of result.patterns) {
    console.log(
      '  ' + confidenceBadge(p.confidence) + '  ' +
      chalk.bold(p.name.padEnd(22)) +
      String(p.sessionCount).padStart(4) + ' 세션  ' + formatBytes(p.totalBytes)
    )
  }
  if (result.skippedCount > 0) {
    console.log(chalk.dim('\n  (' + result.skippedCount + '개 패턴 필터링됨)'))
  }
  console.log(chalk.dim('\n  ' + result.rawSummary))
}

// ─── init ────────────────────────────────────────────────────────────────────

export const initCommand = new Command('init')
  .description('초기 설정')
  .action(async () => {
    console.log(chalk.bold('\n  agent-cli 초기 설정\n'))
    const answers = await inquirer.prompt([{
      type: 'list',
      name: 'mode',
      message: '에이전트 생성 위치:',
      choices: [
        { name: '개인용  (~/.claude/agents/)', value: 'personal' },
        { name: '팀 공유 (현재 repo .claude/agents/)', value: 'team' },
      ],
    }])
    let claudeDir: string
    try {
      claudeDir = detectClaudeDir()
    } catch (e: any) {
      console.error(chalk.red('\n  ✗ ' + e.message + '\n'))
      process.exit(1)
    }
    saveConfig({ claudeDir, defaultMode: answers.mode })
    console.log(chalk.green('\n  ✓ 설정 완료'))
    console.log('  분석 대상: ' + chalk.cyan(claudeDir) + '\n')
  })

// ─── analyze ─────────────────────────────────────────────────────────────────

export const analyzeCommand = new Command('analyze')
  .description('세션 스캔 + 패턴 분석')
  .option('--project <n>', '특정 프로젝트만')
  .option('--no-cache', '캐시 무시')
  .action(async (opts) => {
    const config = loadConfig()
    const cacheFile = path.join(getCacheDir(), 'analysis-' + today() + '.json')

    if (opts.cache && fs.existsSync(cacheFile)) {
      printAnalysisResult(JSON.parse(fs.readFileSync(cacheFile, 'utf-8')))
      console.log(chalk.dim('\n  (캐시 사용 — 재분석: --no-cache)\n'))
      return
    }

    let claudeDir: string
    try {
      claudeDir = config.claudeDir || detectClaudeDir()
    } catch (e: any) {
      console.error(chalk.red('\n  ✗ ' + e.message + '\n'))
      process.exit(1)
    }

    const scanSpinner = ora('  세션 스캔 중...').start()
    let scanResult
    try {
      scanResult = scanSessions(claudeDir, opts.project)
      scanSpinner.succeed(
        '  ' + scanResult.totalSessions + '개 세션 / ' + scanResult.totalSubagents + '개 서브에이전트 발견'
      )
    } catch (e: any) {
      scanSpinner.fail(chalk.red(e.message))
      process.exit(1)
    }

    if (scanResult.totalSubagents === 0) {
      console.log(chalk.yellow('\n  서브에이전트 없음.\n'))
      return
    }

    const analyzeSpinner = ora('  패턴 분석 중 (Claude API)...').start()
    let result: AnalysisResult
    try {
      result = await analyzePatterns(scanResult.subagents, scanResult.gitCommitPaths, '')
      analyzeSpinner.succeed('  분석 완료')
    } catch (e: any) {
      analyzeSpinner.fail(chalk.red('분석 실패: ' + e.message))
      process.exit(1)
    }

    fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2))
    printAnalysisResult(result)
    console.log('\n  ' + chalk.dim("'node dist/index.js generate' 로 에이전트 생성") + '\n')
  })

// ─── generate ────────────────────────────────────────────────────────────────

export const generateCommand = new Command('generate')
  .description('에이전트 파일 생성')
  .option('--all', '체크박스 없이 전체 생성')
  .option('--exclude <names>', '제외할 에이전트 (쉼표 구분, 예: agent-ops,backend-review)')
  .option('--only <names>', '이것만 생성 (쉼표 구분, 예: seo-audit,geo-optimize)')
  .option('--dry-run', '프리뷰만 (파일 생성 안 함)')
  .option('--team', '팀 repo 경로 (.claude/agents/)')
  .action(async (opts) => {
    const config = loadConfig()
    const cacheFile = path.join(getCacheDir(), 'analysis-' + today() + '.json')

    if (!fs.existsSync(cacheFile)) {
      console.error(chalk.red('\n  ✗ 분석 결과 없음. analyze 먼저 실행하세요.\n'))
      process.exit(1)
    }

    const result: AnalysisResult = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
    let candidates: AgentPattern[] = result.patterns

    if (opts.only) {
      const names = opts.only.split(',').map((s: string) => s.trim())
      candidates = candidates.filter(p => names.includes(p.name))
    }
    if (opts.exclude) {
      const names = opts.exclude.split(',').map((s: string) => s.trim())
      candidates = candidates.filter(p => !names.includes(p.name))
    }

    if (candidates.length === 0) {
      console.log(chalk.yellow('\n  생성할 후보 없음.\n'))
      return
    }

    // --all, --only, --dry-run 아닐 때 체크박스
    if (!opts.all && !opts.only && !opts.dryRun) {
      const { selected } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selected',
        message: '생성할 에이전트 선택 (스페이스: 선택/해제, 엔터: 확인):',
        choices: candidates.map(p => ({
          name: p.name.padEnd(24) + ' ' + confidenceBadge(p.confidence) + ' ' + p.sessionCount + '회  ' + formatBytes(p.totalBytes),
          value: p.name,
          checked: p.confidence === 'high',
        })),
      }])
      if (selected.length === 0) {
        console.log(chalk.dim('\n  선택 없음. 취소.\n'))
        return
      }
      candidates = candidates.filter(p => selected.includes(p.name))
    }

    const outputDir = opts.team ? process.cwd() : os.homedir()
    console.log(chalk.bold('\n  생성 예정:\n'))
    for (const p of candidates) {
      const target = opts.team
        ? '.claude/agents/' + p.name + '.md'
        : '~/.claude/agents/' + p.name + '.md'
      console.log('  ' + chalk.green('+') + ' ' + target)
      console.log('    ' + confidenceBadge(p.confidence) + ' ' + p.sessionCount + '회  ' + formatBytes(p.totalBytes))
      console.log('    ' + chalk.dim(p.representativeDescriptions.slice(0, 2).join(' / ')) + '\n')
    }

    if (opts.dryRun) {
      console.log(chalk.dim('  (dry-run — 파일 생성 없음)\n'))
      return
    }

    const { confirmed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmed',
      message: '  ' + candidates.length + '개 에이전트를 생성하시겠습니까?',
      default: true,
    }])

    if (!confirmed) {
      console.log(chalk.dim('\n  취소\n'))
      return
    }

    console.log()
    for (const pattern of candidates) {
      const spinner = ora('  ' + pattern.name + '.md 생성 중...').start()
      try {
        const agent = await generateAgentFile(pattern, '')
        const filePath = writeAgentFile(agent, outputDir)
        spinner.succeed('  ' + chalk.green('✓') + ' ' + path.relative(process.cwd(), filePath))
      } catch (e: any) {
        spinner.fail(chalk.red('  ✗ ' + pattern.name + ': ' + e.message))
      }
    }

    console.log(chalk.bold('\n  완료. `claude agents` 로 로드 확인하세요.\n'))
  })
