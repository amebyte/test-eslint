const fs = require('fs')
const { promisify } = require("util")
const espree = require('espree')
const path = require('path')
const evk = require("eslint-visitor-keys")
const NodeEventGenerator = require("./node-event-generator")
const createEmitter = require("./safe-emitter")
const SourceCodeFixer = require("./source-code-fixer")

const { SourceCode } = require("./source-code")
const Rules = require("./rules")
const createReportTranslator = require("./report-translator")

const Traverser = require("./traverser")

const writeFile = promisify(fs.writeFile)

const filePath = path.resolve('./test.js')
const text = fs.readFileSync(filePath, "utf8")

const configuredRules = {
    // quotes: [1, "single"],
    "no-var": [1]
    // "no-unused-vars": [1]
 }

 const slots = { 
    ruleMap: new Rules()
}

// 编译成AST
const ast = espree.parse(stripUnicodeBOM(text),{ 
    comment: true,
    ecmaVersion: 6,
    ecmaFeatures: { jsx: true, globalReturn: true }, 
    loc: true,
    range: true,
    raw: true,
    tokens: true
})

const sourceCode = new SourceCode({
    text,
    ast,
    parserServices: {},
    scopeManager:null,
    visitorKeys: evk.KEYS
})

const DEPRECATED_SOURCECODE_PASSTHROUGHS = {
    getSource: "getText",
    getSourceLines: "getLines",
    getAllComments: "getAllComments",
    getNodeByRangeIndex: "getNodeByRangeIndex",
    getComments: "getComments",
    getCommentsBefore: "getCommentsBefore",
    getCommentsAfter: "getCommentsAfter",
    getCommentsInside: "getCommentsInside",
    getJSDocComment: "getJSDocComment",
    getFirstToken: "getFirstToken",
    getFirstTokens: "getFirstTokens",
    getLastToken: "getLastToken",
    getLastTokens: "getLastTokens",
    getTokenAfter: "getTokenAfter",
    getTokenBefore: "getTokenBefore",
    getTokenByRangeStart: "getTokenByRangeStart",
    getTokens: "getTokens",
    getTokensAfter: "getTokensAfter",
    getTokensBefore: "getTokensBefore",
    getTokensBetween: "getTokensBetween"
};

// Object.freeze() 方法可以冻结一个对象。一个被冻结的对象再也不能被修改；冻结了一个对象则不能向这个对象添加新的属性，不能删除已有属性，不能修改该对象已有属性的可枚举性、可配置性、可写性，以及不能修改已有属性的值。此外，冻结一个对象后该对象的原型也不能被修改。freeze() 返回和传入的参数相同的对象。
const BASE_TRAVERSAL_CONTEXT = Object.freeze(
    Object.keys(DEPRECATED_SOURCECODE_PASSTHROUGHS).reduce(
        (contextInfo, methodName) =>
            Object.assign(contextInfo, {
                [methodName](...args) {
                    return this.getSourceCode()[DEPRECATED_SOURCECODE_PASSTHROUGHS[methodName]](...args);
                }
            }),
        {}
    )
);


let lintingProblems = []
lintingProblems = runRules(
    sourceCode,
    configuredRules,
    ruleId => getRule(slots, ruleId),
);

console.log(lintingProblems)
const messages = lintingProblems
const shouldFix = true
const currentText = text
fixedResult = SourceCodeFixer.applyFixes(currentText, messages, shouldFix);
console.log(fixedResult)
writeFile(filePath, fixedResult.output)

function runRules(sourceCode, configuredRules, ruleMapper) {
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

    const sharedTraversalContext = Object.freeze(
        Object.assign(
            Object.create(BASE_TRAVERSAL_CONTEXT),
            {
                getSourceCode: () => sourceCode,
            }
        )
    );

    const lintingProblems = [];

    Object.keys(configuredRules).forEach(ruleId => {

        const rule = ruleMapper(ruleId);

        const messageIds = rule.meta && rule.meta.messages;
        let reportTranslator = null;
        const ruleContext = Object.freeze(
            Object.assign(
                Object.create(sharedTraversalContext),
                {
                    id: ruleId,
                    options: getRuleOptions(configuredRules[ruleId]),
                    report(...args) {

                        if (reportTranslator === null) {
                            reportTranslator = createReportTranslator({
                                ruleId,
                                sourceCode,
                                messageIds,
                            });
                        }
                        const problem = reportTranslator(...args);
                        lintingProblems.push(problem);
                    }
                }
            )
        );

        const ruleListeners = rule.create(ruleContext);

        Object.keys(ruleListeners).forEach(selector => {
            const ruleListener = ruleListeners[selector];
            emitter.on(
                selector,
                ruleListener
            );
        });
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

function stripUnicodeBOM(text) {
    if (text.charCodeAt(0) === 0xFEFF) {
        return text.slice(1);
    }
    return text;
}

function getRuleOptions(ruleConfig) {
    if (Array.isArray(ruleConfig)) {
        return ruleConfig.slice(1);
    }
    return [];
}

function getRule(slots, ruleId) {
    return slots.ruleMap.get(ruleId);
}