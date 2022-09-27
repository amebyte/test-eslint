const fs = require('fs')
const eslintScope = require("eslint-scope")
const espree = require('espree')
const path = require('path')
const evk = require("eslint-visitor-keys")
const NodeEventGenerator = require("./node-event-generator")
const CodePathAnalyzer = require("./code-path-analysis/code-path-analyzer")
const createEmitter = require("./safe-emitter")

const { SourceCode } = require("../source-code")
const Rules = require("./rules")
const createReportTranslator = require("./report-translator")

const Traverser = require("./traverser");
const filePath = path.resolve('./test.js')

const text = fs.readFileSync(filePath, "utf8")

const parser = espree
const config = providedConfig || {}

const envInFile = {}
const resolvedEnvConfig = Object.assign({ builtin: true }, config.env, envInFile);
const enabledEnvs = Object.keys(resolvedEnvConfig)
    .filter(envName => resolvedEnvConfig[envName])
    .map(envName => getEnv(slots, envName))
    .filter(env => env);

const parserOptions = resolveParserOptions(parser, config.parserOptions || {}, enabledEnvs);
const languageOptions = createLanguageOptions({
    globals: config.globals,
    parser,
    parserOptions
});

const ast = espree.parse(stripUnicodeBOM(text),{ 
    comment: true,
    ecmaVersion: 6,
    eslintScopeManager: true,
    eslintVisitorKeys: true,  
    filePath: filePath,
    ecmaFeatures: { jsx: true, globalReturn: true }, 
    loc: true,
    range: true,
    raw: true,
    sourceType: undefined,
    tokons: true
})

const visitorKeys = evk.KEYS
const scopeManager = analyzeScope(ast, languageOptions, visitorKeys)

const sourceCode = new SourceCode({
    text,
    ast,
    parserServices: {},
    scopeManager,
    visitorKeys:  evk.KEYS
})

// const nodeQueue = [];
// console.log(text, ast)
// Traverser.traverse(sourceCode.ast, {
//     enter(node, parent) {
//         node.parent = parent;
//         nodeQueue.push({ isEntering: true, node });
//     },
//     leave(node) {
//         nodeQueue.push({ isEntering: false, node });
//     },
//     visitorKeys: sourceCode.visitorKeys
// })
let lintingProblems = []
try{
    lintingProblems = runRules(
        sourceCode,
        configuredRules,
        ruleId => getRule(slots, ruleId),
        parserName,
        languageOptions,
        settings,
        options.filename,
        options.disableFixes,
        slots.cwd,
        providedOptions.physicalFilename
    );
} catch(err){
    console.log(err)
}


function runRules(sourceCode, configuredRules, ruleMapper, parserName, languageOptions, settings, filename, disableFixes, cwd, physicalFilename) {
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
                getDeclaredVariables: sourceCode.scopeManager.getDeclaredVariables.bind(sourceCode.scopeManager),
                getCwd: () => cwd,
                getFilename: () => filename,
                getPhysicalFilename: () => physicalFilename || filename,

                getSourceCode: () => sourceCode,
                parserOptions: {
                    ...languageOptions.parserOptions
                },
                parserPath: parserName,
                languageOptions,
                parserServices: sourceCode.parserServices,
                settings
            }
        )
    );

    const lintingProblems = [];

    Object.keys(configuredRules).forEach(ruleId => {
        const severity = ConfigOps.getRuleSeverity(configuredRules[ruleId]);

        // not load disabled rules
        if (severity === 0) {
            return;
        }

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
                                severity,
                                sourceCode,
                                messageIds,
                                disableFixes
                            });
                        }
                        const problem = reportTranslator(...args);

                        if (problem.fix && !(rule.meta && rule.meta.fixable)) {
                            throw new Error("Fixable rules must set the `meta.fixable` property to \"code\" or \"whitespace\".");
                        }
                        if (problem.suggestions && !(rule.meta && rule.meta.hasSuggestions === true)) {
                            if (rule.meta && rule.meta.docs && typeof rule.meta.docs.suggestion !== "undefined") {

                                // Encourage migration from the former property name.
                                throw new Error("Rules with suggestions must set the `meta.hasSuggestions` property to `true`. `meta.docs.suggestion` is ignored by ESLint.");
                            }
                            throw new Error("Rules with suggestions must set the `meta.hasSuggestions` property to `true`.");
                        }
                        lintingProblems.push(problem);
                    }
                }
            )
        );

        const ruleListeners = timing.enabled ? timing.time(ruleId, createRuleListeners)(rule, ruleContext) : createRuleListeners(rule, ruleContext);

        /**
         * Include `ruleId` in error logs
         * @param {Function} ruleListener A rule method that listens for a node.
         * @returns {Function} ruleListener wrapped in error handler
         */
        function addRuleErrorHandler(ruleListener) {
            return function ruleErrorHandler(...listenerArgs) {
                try {
                    return ruleListener(...listenerArgs);
                } catch (e) {
                    e.ruleId = ruleId;
                    throw e;
                }
            };
        }

        if (typeof ruleListeners === "undefined" || ruleListeners === null) {
            throw new Error(`The create() function for rule '${ruleId}' did not return an object.`);
        }

        // add all the selectors from the rule as listeners
        Object.keys(ruleListeners).forEach(selector => {
            const ruleListener = timing.enabled
                ? timing.time(ruleId, ruleListeners[selector])
                : ruleListeners[selector];

            emitter.on(
                selector,
                addRuleErrorHandler(ruleListener)
            );
        });
    });

    // only run code path analyzer if the top level node is "Program", skip otherwise
    const eventGenerator = nodeQueue[0].node.type === "Program"
        ? new CodePathAnalyzer(new NodeEventGenerator(emitter, { visitorKeys: sourceCode.visitorKeys, fallback: Traverser.getKeys }))
        : new NodeEventGenerator(emitter, { visitorKeys: sourceCode.visitorKeys, fallback: Traverser.getKeys });

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

console.log(text, ast)


function stripUnicodeBOM(text) {
    if (text.charCodeAt(0) === 0xFEFF) {
        return text.slice(1);
    }
    return text;
}

function analyzeScope(ast, languageOptions, visitorKeys) {
    const parserOptions = languageOptions.parserOptions;
    const ecmaFeatures = parserOptions.ecmaFeatures || {};
    const ecmaVersion = languageOptions.ecmaVersion || DEFAULT_ECMA_VERSION;

    return eslintScope.analyze(ast, {
        ignoreEval: true,
        nodejsScope: ecmaFeatures.globalReturn,
        impliedStrict: ecmaFeatures.impliedStrict,
        ecmaVersion: typeof ecmaVersion === "number" ? ecmaVersion : 6,
        sourceType: languageOptions.sourceType || "script",
        childVisitorKeys: visitorKeys || evk.KEYS,
        fallback: Traverser.getKeys
    });
}


function createLanguageOptions({ globals: configuredGlobals, parser, parserOptions }) {

    const {
        ecmaVersion,
        sourceType
    } = parserOptions;

    return {
        globals: configuredGlobals,
        ecmaVersion: normalizeEcmaVersionForLanguageOptions(ecmaVersion),
        sourceType,
        parser,
        parserOptions
    };
}

function normalizeEcmaVersionForLanguageOptions(ecmaVersion) {

    switch (ecmaVersion) {
        case 3:
            return 3;
        case 5:
        case void 0:
            return 5;

        default:
            if (typeof ecmaVersion === "number") {
                return ecmaVersion >= 2015 ? ecmaVersion : ecmaVersion + 2009;
            }
    }

    return espree.latestEcmaVersion + 2009;
}

function resolveParserOptions(parser, providedOptions, enabledEnvironments) {

    const parserOptionsFromEnv = enabledEnvironments
        .filter(env => env.parserOptions)
        .reduce((parserOptions, env) => merge(parserOptions, env.parserOptions), {});
    const mergedParserOptions = merge(parserOptionsFromEnv, providedOptions || {});
    const isModule = mergedParserOptions.sourceType === "module";

    if (isModule) {
        mergedParserOptions.ecmaFeatures = Object.assign({}, mergedParserOptions.ecmaFeatures, { globalReturn: false });
    }

    mergedParserOptions.ecmaVersion = normalizeEcmaVersion(parser, mergedParserOptions.ecmaVersion);

    return mergedParserOptions;
}

function normalizeEcmaVersion(parser, ecmaVersion) {

    if (isEspree(parser)) {
        if (ecmaVersion === "latest") {
            return espree.latestEcmaVersion;
        }
    }
    return ecmaVersion >= 2015 ? ecmaVersion - 2009 : ecmaVersion;
}

function isEspree(parser) {
    return !!(parser === espree || parser[parserSymbol] === espree);
}

function getEnv(slots, envId) {
    return (
        (slots.lastConfigArray && slots.lastConfigArray.pluginEnvironments.get(envId)) ||
        BuiltInEnvironments.get(envId) ||
        null
    );
}


function createRuleListeners(rule, ruleContext) {
    try {
        return rule.create(ruleContext);
    } catch (ex) {
        ex.message = `Error while loading rule '${ruleContext.id}': ${ex.message}`;
        throw ex;
    }
}

function getRule(slots, ruleId) {
    return (
        (slots.lastConfigArray && slots.lastConfigArray.pluginRules.get(ruleId)) ||
        slots.ruleMap.get(ruleId)
    );
}