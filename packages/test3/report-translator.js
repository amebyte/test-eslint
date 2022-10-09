const ruleFixer = require("./rule-fixer");

function normalizeReportLoc(descriptor) {
    if (descriptor.loc) {
        if (descriptor.loc.start) {
            return descriptor.loc;
        }
        return { start: descriptor.loc, end: null };
    }
    return descriptor.node.loc;
}

function createProblem(options) {
    const problem = {
        message: options.message,
        line: options.loc.start.line,
        column: options.loc.start.column + 1,
        nodeType: options.node && options.node.type || null
    };

    if (options.loc.end) {
        problem.endLine = options.loc.end.line;
        problem.endColumn = options.loc.end.column + 1;
    }

    if (options.fix) {
        problem.fix = options.fix;
    }

    return problem;
}

module.exports = function createReportTranslator(metadata) {
    return (...args) => {
        const descriptor = args[0];

        return createProblem({
            node: descriptor.node,
            message: descriptor.message,
            loc: normalizeReportLoc(descriptor),
            fix: descriptor.fix(ruleFixer),
        });
    };
};
