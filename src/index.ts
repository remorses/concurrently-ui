#!/usr/bin/env node
import { cac } from 'cac';
import blessed from 'blessed';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

interface Task {
  id: string;
  title: string;
  command: string;
  isRunning: boolean;
  logs: string[];
  process?: ReturnType<typeof spawn>;
}

class LogViewer extends EventEmitter {
  private screen!: blessed.Widgets.Screen;
  private sidebar!: blessed.Widgets.ListElement;
  private logBox!: blessed.Widgets.ScrollableBoxElement;
  private tasks: Task[];
  private currentTaskIndex: number = 0;
  private killOnFirst: boolean;

  constructor(commands: string[], killOnFirst: boolean = false) {
    super();
    this.killOnFirst = killOnFirst;
    this.tasks = commands.map((command, index) => ({
      id: `task-${index}`,
      title: command,
      command,
      isRunning: true,
      logs: [],
    }));

    this.initializeUI();
    this.startTasks();
  }

  private initializeUI(): void {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Task Logs',
    });

    // Create sidebar
    this.sidebar = blessed.list({
      width: '20%',
      height: '100%',
      left: 0,
      top: 0,
      style: {
        selected: { bg: 'blue' },
      },
      keys: true,
      vi: true,
      items: this.tasks.map(
        (task) => `${task.isRunning ? '⟳' : ' '} ${task.title}`,
      ),
    });

    // Create log box
    this.logBox = blessed.scrollablebox({
      width: '79%',
      height: '100%',
      left: '21%',
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
    });

    // Add widgets to screen
    this.screen.append(this.sidebar);
    this.screen.append(this.logBox);

    // Handle events
    this.sidebar.on('select', this.handleTaskSelect.bind(this));
    this.screen.key(['q', 'C-c'], () => process.exit(0));

    // Handle arrow keys
    this.screen.key(['up'], () => {
      this.sidebar.up(1);
      this.handleTaskSelect(this.sidebar, this.sidebar.selected);
    });

    this.screen.key(['down'], () => {
      this.sidebar.down(1);
      this.handleTaskSelect(this.sidebar, this.sidebar.selected);
    });

    // Enable mouse wheel scrolling for logBox
    this.logBox.on('wheeldown', () => {
      this.screen.program.enableMouse();
      this.logBox.scroll(1);
      this.screen.render();
    });

    this.logBox.on('wheelup', () => {
      this.screen.program.enableMouse();
      this.logBox.scroll(-1);
      this.screen.render();
    });

    // Initial render
    this.updateLogBox();
    this.screen.render();
  }

  private handleTaskSelect(item: blessed.Widgets.ListElement, index: number): void {
    this.currentTaskIndex = index;
    this.updateLogBox();
  }

  private updateLogBox(): void {
    const task = this.tasks[this.currentTaskIndex];
    this.logBox.setContent(task.logs.join('\n'));
    this.screen.render();
  }

  private startTasks(): void {
    this.tasks.forEach((task, index) => {
      if (task.isRunning) {
        const process = spawn('sh', ['-c', task.command]);
        task.process = process;

        process.stdout.on('data', (data) => {
          task.logs.push(data.toString());
          if (this.currentTaskIndex === index) {
            this.updateLogBox();
          }
        });

        process.stderr.on('data', (data) => {
          task.logs.push(`{red-fg}${data.toString()}{/red-fg}`);
          if (this.currentTaskIndex === index) {
            this.updateLogBox();
          }
        });

        process.on('exit', (code) => {
          task.isRunning = false;
          task.logs.push(`\n{yellow-fg}Process exited with code ${code}{/yellow-fg}`);
          if (this.currentTaskIndex === index) {
            this.updateLogBox();
          }

          if (this.killOnFirst) {
            this.killAllTasks();
          }
        });

        // Update spinner animation
        let spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let spinnerIndex = 0;

        setInterval(() => {
          if (task.isRunning) {
            const item = this.sidebar.getItem(index);
            item.content = `${spinnerFrames[spinnerIndex]} ${task.title}`;
            this.screen.render();
            spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
          }
        }, 80);
      }
    });
  }

  private killAllTasks(): void {
    this.tasks.forEach(task => {
      if (task.isRunning && task.process) {
        task.process.kill();
      }
    });
  }
}

const cli = cac('concurrently-ui');

cli
  .option('-k, --kill', 'Kill all commands when first command exits', {
    default: false
  })
  .help();

const parsed = cli.parse();

if (parsed.args.length === 0) {
  console.error('Error: At least one command is required');
  process.exit(1);
}

new LogViewer(parsed.args, parsed.options.kill); 