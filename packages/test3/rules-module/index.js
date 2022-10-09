/**
 * @fileoverview Collects the built-in rules into a map structure so that they can be imported all at once and without
 * using the file-system directly.
 * @author Peter (Somogyvari) Metz
 */

 "use strict";

 /* eslint sort-keys: ["error", "asc"] -- More readable for long list */
 
 const { LazyLoadingRuleMap } = require("./utils/lazy-loading-rule-map");
 
 /** @type {Map<string, import("../shared/types").Rule>} */
 module.exports = new LazyLoadingRuleMap(Object.entries({
     quotes: () => require("./quotes"),
     "no-var": () => require("./no-var"),
    //  "no-unused-vars": () => require("./no-unused-vars"),
 }));
 