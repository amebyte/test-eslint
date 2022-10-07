const esquery = require("esquery");

/**
 * Gets the possible types of a selector
 * @param {Object} parsedSelector An object (from esquery) describing the matching behavior of the selector
 * @returns {string[]|null} The node types that could possibly trigger this selector, or `null` if all node types could trigger it
 */
function getPossibleTypes(parsedSelector) {
    switch (parsedSelector.type) {
        case "identifier":
            return [parsedSelector.value];
        default:
            return null;

    }
}

const selectorCache = new Map();

/**
 * Parses a raw selector string, and returns the parsed selector along with specificity and type information.
 * @param {string} rawSelector A raw AST selector
 * @returns {ASTSelector} A selector descriptor
 */
function parseSelector(rawSelector) {
    if (selectorCache.has(rawSelector)) {
        return selectorCache.get(rawSelector);
    }

    const parsedSelector = esquery.parse(rawSelector.replace(/:exit$/u, ""));

    const result = {
        rawSelector,
        isExit: rawSelector.endsWith(":exit"),
        parsedSelector,
        listenerTypes: getPossibleTypes(parsedSelector),
    };

    selectorCache.set(rawSelector, result);
    return result;
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * The event generator for AST nodes.
 * This implements below interface.
 *
 * ```ts
 * interface EventGenerator {
 *     emitter: SafeEmitter;
 *     enterNode(node: ASTNode): void;
 *     leaveNode(node: ASTNode): void;
 * }
 * ```
 */
class NodeEventGenerator {

    /**
     * @param {SafeEmitter} emitter
     * An SafeEmitter which is the destination of events. This emitter must already
     * have registered listeners for all of the events that it needs to listen for.
     * (See lib/linter/safe-emitter.js for more details on `SafeEmitter`.)
     * @param {ESQueryOptions} esqueryOptions `esquery` options for traversing custom nodes.
     * @returns {NodeEventGenerator} new instance
     */
    constructor(emitter, esqueryOptions) {
        this.emitter = emitter;
        this.esqueryOptions = esqueryOptions;
        this.currentAncestry = [];
        this.enterSelectorsByNodeType = new Map();
        this.exitSelectorsByNodeType = new Map();

        emitter.eventNames().forEach(rawSelector => {
            const selector = parseSelector(rawSelector);

            if (selector.listenerTypes) {
                const typeMap = selector.isExit ? this.exitSelectorsByNodeType : this.enterSelectorsByNodeType;

                selector.listenerTypes.forEach(nodeType => {
                    if (!typeMap.has(nodeType)) {
                        typeMap.set(nodeType, []);
                    }
                    typeMap.get(nodeType).push(selector);
                });
                return;
            }
        });
    }

    /**
     * Checks a selector against a node, and emits it if it matches
     * @param {ASTNode} node The node to check
     * @param {ASTSelector} selector An AST selector descriptor
     * @returns {void}
     */
    applySelector(node, selector) {
        if (esquery.matches(node, selector.parsedSelector, this.currentAncestry, this.esqueryOptions)) {
            this.emitter.emit(selector.rawSelector, node);
        }
    }

    /**
     * Applies all appropriate selectors to a node, in specificity order
     * @param {ASTNode} node The node to check
     * @param {boolean} isExit `false` if the node is currently being entered, `true` if it's currently being exited
     * @returns {void}
     */
    applySelectors(node, isExit) {
        const selectorsByNodeType = (isExit ? this.exitSelectorsByNodeType : this.enterSelectorsByNodeType).get(node.type) || [];

        /*
         * selectorsByNodeType and anyTypeSelectors were already sorted by specificity in the constructor.
         * Iterate through each of them, applying selectors in the right order.
         */
        let selectorsByTypeIndex = 0;

        while (selectorsByTypeIndex < selectorsByNodeType.length ) {
                this.applySelector(node, selectorsByNodeType[selectorsByTypeIndex++]);
        }
    }

    /**
     * Emits an event of entering AST node.
     * @param {ASTNode} node A node which was entered.
     * @returns {void}
     */
    enterNode(node) {
        if (node.parent) {
            this.currentAncestry.unshift(node.parent);
        }
        this.applySelectors(node, false);
    }

    /**
     * Emits an event of leaving AST node.
     * @param {ASTNode} node A node which was left.
     * @returns {void}
     */
    leaveNode(node) {
        this.applySelectors(node, true);
        this.currentAncestry.shift();
    }
}

module.exports = NodeEventGenerator;
