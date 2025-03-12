// Utility for colorful console logging
export const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",

    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",

    bgBlack: "\x1b[40m",
    bgRed: "\x1b[41m",
    bgGreen: "\x1b[42m",
    bgYellow: "\x1b[43m",
    bgBlue: "\x1b[44m",
    bgMagenta: "\x1b[45m",
    bgCyan: "\x1b[46m",
    bgWhite: "\x1b[47m"
};

export const log = {
    info: (...args) => console.log(`${colors.cyan}[INFO]${colors.reset}`, ...args),
    success: (...args) => console.log(`${colors.green}[SUCCESS]${colors.reset}`, ...args),
    warn: (...args) => console.log(`${colors.yellow}[WARNING]${colors.reset}`, ...args),
    error: (...args) => console.error(`${colors.red}[ERROR]${colors.reset}`, ...args),
    debug: (...args) => console.log(`${colors.magenta}[DEBUG]${colors.reset}`, ...args),
    start: (...args) => console.log(`${colors.green}[START]${colors.reset} ${colors.bright}`, ...args, colors.reset),
    custom: (label, ...args) => {
        const labelColor = args[0]?.color || colors.blue;
        console.log(`${labelColor}[${label}]${colors.reset}`, ...args.slice(args[0]?.color ? 1 : 0));
    }
};
