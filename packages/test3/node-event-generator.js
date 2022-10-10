const esquery = require("esquery");

/**
 * 获取选择器的可能类型
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
 * 分析原始选择器字符串，并返回已分析的选择器以及特定性和类型信息
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

class NodeEventGenerator {
    constructor(emitter) {
        this.emitter = emitter;
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
     * 根据节点检查选择器，如果匹配则发出
     */
    applySelector(node, selector) {
        this.emitter.emit(selector.rawSelector, node);
    }

    /**
     * 按特定顺序将所有适当的选择器应用于节点
     */
    applySelectors(node, isExit) {
        const selectorsByNodeType = (isExit ? this.exitSelectorsByNodeType : this.enterSelectorsByNodeType).get(node.type) || [];
        let selectorsByTypeIndex = 0;
        while (selectorsByTypeIndex < selectorsByNodeType.length ) {
                this.applySelector(node, selectorsByNodeType[selectorsByTypeIndex++]);
        }
    }

    /**
     * 发出进入AST节点的事件
     */
    enterNode(node) {
        this.applySelectors(node, false);
    }

    /**
     * 发出离开AST节点的事件
     */
    leaveNode(node) {
        this.applySelectors(node, true);
    }
}

module.exports = NodeEventGenerator;
