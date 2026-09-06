#!/usr/bin/env node
import { Command } from 'commander'
import { initCommand, analyzeCommand, generateCommand } from './commands/index.js'

const program = new Command()

program
  .name('agent-cli')
  .description('Claude Code 세션 분석 → 커스텀 에이전트 자동 생성')
  .version('0.1.0')

program.addCommand(initCommand)
program.addCommand(analyzeCommand)
program.addCommand(generateCommand)

program.parse()
