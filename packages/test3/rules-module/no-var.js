 module.exports = {
   create(context) {
     const sourceCode = context.getSourceCode()
     return {
        VariableDeclaration(node) {
            if(node.kind === 'var') {
              context.report({
                 node,
                 message:'不能用var',
                 fix(fixer) {
                     const varToken = sourceCode.getFirstToken(node)
                     return fixer.replaceText(varToken, 'let')
                 }
              })
            }
        }
     };
   },
 };
 