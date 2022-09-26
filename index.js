const fs = require('fs')
const espree = require('espree')
const path = require('path')
const evk = require("eslint-visitor-keys")

const Traverser = require("./traverser");
const filePath = path.resolve('./test.js')
const text = fs.readFileSync(filePath, "utf8")
const ast = espree.parse(stripUnicodeBOM(text),{ ecmaVersion: 6, ecmaFeatures: { jsx: true }})

const sourceCode = { ast, visitorKeys: evk.KEYS}

const nodeQueue = [];
console.log(text, ast)
Traverser.traverse(sourceCode.ast, {
    enter(node, parent) {
        node.parent = parent;
        nodeQueue.push({ isEntering: true, node });
    },
    leave(node) {
        nodeQueue.push({ isEntering: false, node });
    },
    visitorKeys: sourceCode.visitorKeys
})

console.log(text, ast)

/**
 * Strips Unicode BOM from a given text.
 * @param {string} text A text to strip.
 * @returns {string} The stripped text.
 */
 function stripUnicodeBOM(text) {

    /*
     * Check Unicode BOM.
     * In JavaScript, string data is stored as UTF-16, so BOM is 0xFEFF.
     * http://www.ecma-international.org/ecma-262/6.0/#sec-unicode-format-control-characters
     */
    if (text.charCodeAt(0) === 0xFEFF) {
        return text.slice(1);
    }
    return text;
}