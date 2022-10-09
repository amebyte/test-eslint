 const breakableTypePattern = /^(?:(?:Do)?While|For(?:In|Of)?|Switch)Statement$/u;
 const lineBreakPattern = /\r\n|[\r\n\u2028\u2029]/u;
 const shebangPattern = /^#!([^\r\n]+)/u;
 
 function createGlobalLinebreakMatcher() {
     return new RegExp(lineBreakPattern.source, "gu");
 }
 
 module.exports = {
     breakableTypePattern,
     lineBreakPattern,
     createGlobalLinebreakMatcher,
     shebangPattern
 };
 