#!/usr/bin/env node
import { cac } from 'cac'
import blessed from 'blessed'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import pc from 'picocolors'

interface Task {
    id: string
    title: string
    command: string
    isRunning: boolean
    logs: string[]
    process?: ReturnType<typeof spawn>
    exitCode?: number
}

interface LogViewerOptions {
    commands: string[]
    killOthers: boolean
    killOthersOnFail: boolean
}

class LogViewer extends EventEmitter {
    private screen!: blessed.Widgets.Screen
    private sidebar!: blessed.Widgets.ListElement
    private logBox!: blessed.Widgets.ScrollableBoxElement
    private tasks: Task[]
    private currentTaskIndex: number = 0
    private options: LogViewerOptions
    private spinnerIntervals: NodeJS.Timeout[] = []

    constructor(options: LogViewerOptions) {
        super()
        this.options = options
        this.tasks = options.commands.map((command, index) => ({
            id: `task-${index}`,
            title: command,
            command,
            isRunning: true,
            logs: [],
        }))

        this.initializeUI()
        this.startTasks()
    }

    private initializeUI(): void {
        this.screen = blessed.screen({
            smartCSR: true,
            title: 'Task Logs',
        })
        const left = 20
        // Create sidebar
        this.sidebar = blessed.list({
            width: left,
            height: '100%',
            left: 0,
            top: 0,
            style: {
                selected: { bg: 'blue' },
            },
            keys: true,
            vi: true,
            items: this.tasks.map((task) => this.getTaskLabel(task)),
        })

        this.logBox = blessed.scrollablebox({
            width: this.screen.cols - left,
            height: '100%',
            left: left,
            top: 0,
            scrollable: true,
            alwaysScroll: true,
            tags: true,
            mouse: true,
            scrollbar: {
                ch: '█',
                track: {
                    bg: 'black',
                },
                style: {
                    inverse: true,
                },
            },
            clickable: true,
        })

        // Add widgets to screen
        this.screen.append(this.sidebar)
        this.screen.append(this.logBox)

        // Handle events
        this.sidebar.on('select', this.handleTaskSelect.bind(this))
        this.screen.key(['q', 'C-c'], () => {
            this.cleanup()
            process.exit(0)
        })

        // Handle arrow keys
        this.screen.key(['up'], () => {
            this.sidebar.up(1)
            this.handleTaskSelect(this.sidebar, this.sidebar['selected'])
        })

        this.screen.key(['down'], () => {
            this.sidebar.down(1)
            this.handleTaskSelect(this.sidebar, this.sidebar['selected'])
        })

        // Enable mouse wheel scrolling for logBox
        this.logBox.on('wheeldown', () => {
            this.screen.program.enableMouse()
            this.logBox.scroll(1)
            this.screen.render()
        })

        this.logBox.on('wheelup', () => {
            this.screen.program.enableMouse()
            this.logBox.scroll(-1)
            this.screen.render()
        })

        // Handle terminal resize
        this.screen.on('resize', () => {
            this.logBox.width = this.screen.cols - left
            this.updateLogBox()
        })

        // Initial render
        this.updateLogBox()
        this.screen.render()
    }

    private getTaskLabel(task: Task): string {
        if (task.isRunning) {
            return `⟳ ${task.title}`
        }
        if (task.exitCode === 0) {
            return `${pc.green('✓')} ${task.title}`
        }
        return `✗ ${task.title}`
    }

    private handleTaskSelect(
        item: blessed.Widgets.ListElement,
        index: number,
    ): void {
        this.currentTaskIndex = index
        this.updateLogBox()
    }

    private updateLogBox(): void {
        const task = this.tasks[this.currentTaskIndex]
        this.logBox.setContent(task.logs.join('\n'))
        this.screen.render()
    }

    private cleanup(): void {
        this.spinnerIntervals.forEach((interval) => clearInterval(interval))
        this.killAllTasks()
    }

    private startTasks(): void {
        this.tasks.forEach((task, index) => {
            if (task.isRunning) {
                // enable processes tty so colors are enabled
                const p = spawn('script', ['-q', '/dev/null', task.command], {
                    shell: true,
                    env: { FORCE_COLOR: '1', ...process.env },
                    stdio: [process.stdin, 'pipe', 'pipe'],
                })
                task.process = p

                p.stdout.on('data', (data) => {
                    task.logs.push(data.toString())
                    if (this.currentTaskIndex === index) {
                        this.updateLogBox()
                    }
                })

                p.stderr.on('data', (data) => {
                    task.logs.push(pc.red(data.toString()))
                    if (this.currentTaskIndex === index) {
                        this.updateLogBox()
                    }
                })

                p.on('exit', (code) => {
                    task.isRunning = false
                    task.exitCode = code
                    task.logs.push(
                        `\n${pc.yellow(`Process exited with code ${code}`)}`,
                    )
                    if (this.currentTaskIndex === index) {
                        this.updateLogBox()
                    }

                    // Update sidebar item status
                    const item = this.sidebar.getItem(index)
                    item.content = this.getTaskLabel(task)
                    this.screen.render()

                    if (
                        (this.options.killOthers && code === 0) ||
                        (this.options.killOthersOnFail && code !== 0)
                    ) {
                        this.killAllTasks()
                    }
                })

                // Update spinner animation
                let spinnerFrames = [
                    '⠋',
                    '⠙',
                    '⠹',
                    '⠸',
                    '⠼',
                    '⠴',
                    '⠦',
                    '⠧',
                    '⠇',
                    '⠏',
                ]
                let spinnerIndex = 0

                const interval = setInterval(() => {
                    if (task.isRunning) {
                        const item = this.sidebar.getItem(index)
                        item.content = `${spinnerFrames[spinnerIndex]} ${task.title}`
                        this.screen.render()
                        spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length
                    }
                }, 80)
                this.spinnerIntervals.push(interval)
            }
        })
    }

    private killAllTasks(): void {
        this.tasks.forEach((task) => {
            if (task.isRunning && task.process) {
                task.process.kill()
            }
        })
    }
}

const cli = cac('concurrently-ui')

cli.option('-k, --kill-others', 'Kill all commands when first command exits', {
    default: false,
})
    .option('--kill-others-on-fail', 'Kill all commands if a command fails', {
        default: false,
    })
    .help()

const parsed = cli.parse()

if (parsed.args.length === 0) {
    console.error('Error: At least one command is required')
    process.exit(1)
}

new LogViewer({
    commands: parsed.args as string[],
    killOthers: parsed.options.killOthers,
    killOthersOnFail: parsed.options.killOthersOnFail,
})
