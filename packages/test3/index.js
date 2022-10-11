const fs = require('fs')
const { promisify } = require("util")
const espree = require('espree')
const path = require('path')
const NodeEventGenerator = require("./node-event-generator")
const createEmitter = require("./safe-emitter")
const SourceCodeFixer = require("./source-code-fixer")

const { SourceCode } = require("./source-code")
const rule = require("./rules-module/no-var")
const createReportTranslator = require("./report-translator")

const Traverser = require("./traverser")

const writeFile = promisify(fs.writeFile)

const filePath = path.resolve('./test.js')
const text = fs.readFileSync(filePath, "utf8")

// 编译成AST
const ast = espree.parse(text,{ 
    comment: true,
    ecmaVersion: 6,
    ecmaFeatures: { jsx: true, globalReturn: true }, 
    loc: true,
    range: true,
    tokens: true
})

const sourceCode = new SourceCode({
    text,
    ast
})

let lintingProblems = []
lintingProblems = runRules(sourceCode);

console.log(lintingProblems)
const messages = lintingProblems
const shouldFix = true
const currentText = text
fixedResult = SourceCodeFixer.applyFixes(currentText, messages, shouldFix);
console.log(fixedResult)
writeFile(filePath, fixedResult.output)

function runRules(sourceCode) {
    const emitter = createEmitter();
    const nodeQueue = [];
    let currentNode = sourceCode.ast;

    Traverser.traverse(sourceCode.ast, {
        enter(node, parent) {
            node.parent = parent;
            nodeQueue.push({ isEntering: true, node });
        },
        leave(node) {
            nodeQueue.push({ isEntering: false, node });
        },
        visitorKeys: sourceCode.visitorKeys
    });

    const lintingProblems = [];
    let reportTranslator = null;
    // 构建规则插件的上下文对象
    const ruleContext = {
        getSourceCode: () => sourceCode,
        report(...args) {

            if (reportTranslator === null) {
                reportTranslator = createReportTranslator({
                    sourceCode,
                });
            }
            const problem = reportTranslator(...args);
            lintingProblems.push(problem);
        }
    }

    const ruleListeners = rule.create(ruleContext);

    Object.keys(ruleListeners).forEach(selector => {
        const ruleListener = ruleListeners[selector];
        emitter.on(
            selector,
            ruleListener
        );
    });

    const eventGenerator = new NodeEventGenerator(emitter);

    nodeQueue.forEach(traversalInfo => {
        currentNode = traversalInfo.node;
        try {
            if (traversalInfo.isEntering) {
                eventGenerator.enterNode(currentNode);
            } else {
                eventGenerator.leaveNode(currentNode);
            }
        } catch (err) {
            err.currentNode = currentNode;
            throw err;
        }
    });

    return lintingProblems;
}