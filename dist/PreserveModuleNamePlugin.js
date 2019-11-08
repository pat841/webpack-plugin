"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
exports.preserveModuleName = Symbol();
const TAP_NAME = "Aurelia:PreserveModuleName";
// node_module maps
let _nodeModuleResourcesMap = {};
let _nodeModuleResourceIdMap = {};
// This plugins preserves the module names of IncludeDependency and
// AureliaDependency so that they can be dynamically requested by
// aurelia-loader.
// All other dependencies are handled by webpack itself and don't
// need special treatment.
class PreserveModuleNamePlugin {
    constructor(isDll = false) {
        this.isDll = isDll;
    }
    apply(compiler) {
        compiler.hooks.compilation.tap(TAP_NAME, (compilation) => {
            compilation.hooks.beforeModuleIds.tap(TAP_NAME, (modules) => {
                const { modules: roots, extensions, alias } = compilation.options.resolve;
                const modulePaths = roots.map((p) => path.resolve(p));
                const extensionNormalizers = extensions.map((ext) => new RegExp(`${ext.replace(/\./g, '\\.')}$`, 'i'));
                // Get every module even if they were concatenated
                const rawModules = expandConcatenatedModules(modules);
                // Map and parse the modules if needed
                rawModules.forEach((m) => mapNodeModule(m));
                parseNodeModules();
                // Set the id for each preserved module
                getPreservedModules(modules).forEach((module) => {
                    // Even though it's imported by Aurelia, it's still possible that the module
                    // became the _root_ of a ConcatenatedModule. We still need compatability with Webpack 2.
                    const rawModule = (module.constructor.name === 'ConcatenatedModule') ? module.rootModule : module;
                    if (!rawModule) {
                        return;
                    }
                    // Get the module id
                    let moduleId = getModuleId(rawModule, modulePaths, alias);
                    if (!moduleId) {
                        throw new Error(`Can't figure out a normalized module name for ${rawModule.rawRequest}, please call PLATFORM.moduleName() somewhere to help.`);
                    }
                    // Normalize the extension from the id if needed
                    extensionNormalizers.forEach((n) => {
                        if (moduleId) {
                            moduleId = moduleId.replace(n, '');
                        }
                    });
                    // Keep async! in front of code split proxies, they are used by the aurelia-loader
                    if (rawModule.rawRequest && /^async[?!]/.test(rawModule.rawRequest)) {
                        moduleId = `async!${moduleId}`;
                    }
                    // Metadata?
                    moduleId = moduleId.replace(/\\/g, '/');
                    if (module.buildMeta) {
                        module.buildMeta['aurelia-id'] = moduleId;
                    }
                    // Only save the module id if were not a dll
                    if (!this.isDll) {
                        module[exports.preserveModuleName] = moduleId;
                        module.id = moduleId;
                    }
                });
            });
        });
    }
}
exports.PreserveModuleNamePlugin = PreserveModuleNamePlugin;
;
/**
 *  ModuleConcatenationPlugin merges modules in a new ConcatenatedModule
 *  We need to remove each modules grouping in place of the modules
 *  themselves
 *
 *  @param  {Webpack.Module[]} modules The modules to expand
 *
 *  @return {Webpack.Module[]} The expanded modules
 */
function expandConcatenatedModules(modules) {
    if (!modules || !Array.isArray(modules)) {
        return [];
    }
    let modulesBeforeConcat = modules.slice();
    for (let i = 0; i < modulesBeforeConcat.length; i++) {
        const m = modulesBeforeConcat[i];
        // We don't `import ConcatenatedModule` and then `m instanceof ConcatenatedModule`
        // because it was introduced in Webpack 3.0 and we're still compatible with 2.x at the moment.
        if (m.constructor.name === 'ConcatenatedModule') {
            m.modules = (Array.isArray(m.modules)) ? m.modules : [];
            modulesBeforeConcat.splice(i--, 1, ...m.modules);
        }
    }
    return modulesBeforeConcat;
}
/**
 *  Get the filtered list of PLATFORM.moduleName() imported modules
 *
 *  @param  {Webpack.Module[]} modules The modules to filter
 *
 *  @return {Webpack.Module[]} The imported modules
 */
function getPreservedModules(modules) {
    if (!modules || !Array.isArray(modules)) {
        return [];
    }
    return modules.filter((module) => {
        // Preserve the module itself?
        if (module[exports.preserveModuleName]) {
            return true;
        }
        // Preserve the module if its dependencies are also preserved
        const reasons = (module.reasons && Array.isArray(module.reasons)) ? module.reasons : [];
        return reasons.some((reason) => Boolean(reason.dependency && reason.dependency[exports.preserveModuleName]));
    });
}
/**
 *  Check if a module exists in node_modules/
 *
 *  @param  {Webpack.Module} module The module to check
 *
 *  @return {Boolean} True if it exists in node_modules/, false otherwise
 */
function isNodeModule(module) {
    return !(!module || !module.resource || !(/\bnode_modules\b/i.test(module.resource)));
}
/**
 *  Get module data if it exists in node_modules/
 *
 *  @param  {Webpack.Module} module The module to get the data for
 *
 *  @return {NodeModule.Data|null} The module data if available, null otherwise
 */
function getNodeModuleData(module) {
    // Not a node_module?
    if (!isNodeModule(module)) {
        return null;
    }
    // Note that the negative lookahead (?!.*node_modules) ensures that we only match the last node_modules/ folder in the path,
    // in case the package was located in a sub-node_modules (which can occur in special circumstances).
    // We also need to take care of scoped modules. If the name starts with @ we must keep two parts,
    // so @corp/bar is the proper module name.
    const modulePaths = module.resource.match(/(.*\bnode_modules[\\/](?!.*\bnode_modules\b)((?:@[^\\/]+[\\/])?[^\\/]+))(.*)/i);
    if (!modulePaths || modulePaths.length !== 4) {
        return null;
    }
    return {
        path: modulePaths[1],
        name: modulePaths[2],
        relative: modulePaths[3],
    };
}
/**
 *  If a module exists in node_modules/ map its data
 *
 *  @param  {Webpack.Module} module The module to map
 *
 *  @return {undefined}
 */
function mapNodeModule(module) {
    // Not a node_module?
    if (!isNodeModule(module)) {
        return;
    }
    // Get the module data
    const moduleData = getNodeModuleData(module);
    if (!moduleData) {
        return;
    }
    // Map it
    if (!_nodeModuleResourcesMap[moduleData.name]) {
        _nodeModuleResourcesMap[moduleData.name] = {};
    }
    _nodeModuleResourcesMap[moduleData.name][module.resource] = moduleData;
}
/**
 *  Parse the resource map for modules that exist in node_modules/
 *
 *  Since a module can be imported in any number of ways, we cannot rely
 *  on the module request or any other dynamic scenarios. This gets even
 *  more tricky when modules themselves can import their own relative or
 *  even node_modules/.
 *
 *  In order to remedy this, we look at every module that is resolved in
 *  webpack and combine modules who share a common module path. While this
 *  approach works, it gets complicated when you have to detect the modules
 *  entry point. Luckily, using PLATFORM.moduleName() on the modules entry
 *  point will allow webpack to include the resource when parsing if needed.
 *
 *  However, we need to know exactly which resource is the module entry.
 *  In order to do this, we make some assumptions:
 *    - The resource name matches 'index', discounting the extenstion
 *    - The resource name matches the module key exactly
 *    - If there is only one module resource, use that as the entry
 *    - If there are multiple entry points: (index, exact match)
 *        - Pick the resource that is most shallow to the modules root
 *        - Otherwise, choose the 'index' resource
 *
 *  @return {undefined}
 */
function parseNodeModules() {
    if (!_nodeModuleResourcesMap || !Object.keys(_nodeModuleResourcesMap).length) {
        return;
    }
    // Parse each module
    for (const moduleKey in _nodeModuleResourcesMap) {
        const moduleResources = _nodeModuleResourcesMap[moduleKey];
        // Keep track of the common resource path and possible module entry points
        let commonPathParts = [];
        let possibleEntryPoints = [];
        // Parse each resource in the module
        for (const resource in moduleResources) {
            const data = moduleResources[resource];
            const pathParts = data.relative.split('/');
            const resourceFile = pathParts.splice(-1)[0];
            if (!resourceFile) {
                continue;
            }
            // Entry?
            const resourceName = resourceFile.replace(/\..*/, '');
            if (resourceName === moduleKey || resourceName === 'index') {
                possibleEntryPoints.push(resource);
            }
            // Initial or only resource?
            if (!commonPathParts.length) {
                commonPathParts = pathParts.slice();
                continue;
            }
            // Remove uncommon paths
            let cont = true;
            commonPathParts = commonPathParts.reduce((common, segment, idx) => {
                // Same?
                if (cont && segment === pathParts[idx]) {
                    common.push(segment);
                }
                else {
                    cont = false;
                }
                return common;
            }, []);
        }
        // Convert common path to string
        let commonPath = commonPathParts.join('/');
        commonPath = (commonPath.startsWith('/')) ? commonPath : `/${commonPath}`;
        // If there is more than one possible entry point, use the most shallow resource
        let moduleEntry = null;
        possibleEntryPoints.forEach((resource) => {
            const data = moduleResources[resource];
            // No entry yet?
            if (!moduleEntry) {
                moduleEntry = data.relative;
            }
            // Shallow?
            else if (moduleEntry.split('/').length > data.relative.split('/').length) {
                moduleEntry = data.relative;
            }
            // This is an odd edge-case, both are as shallow as possible
            // We attempt to use index over moduleKey
            else if (!(/\bindex\b/i.test(moduleEntry)) && /\bindex\b/i.test(data.relative)) {
                moduleEntry = data.relative;
            }
        });
        // If an entry point still hasnt been found and there is only one resource, use that
        const resourceKeys = Object.keys(moduleResources);
        if (!moduleEntry && resourceKeys.length === 1) {
            moduleEntry = moduleResources[resourceKeys[0]].relative;
        }
        // Map the resources to the module id
        resourceKeys.forEach((resource) => {
            const data = moduleResources[resource];
            // Entry?
            if (moduleEntry === data.relative) {
                _nodeModuleResourceIdMap[resource] = moduleKey;
                return;
            }
            // Build the id from the resources common path
            let key = data.relative.replace(new RegExp(`^${escapeString(commonPath)}`), '');
            key = (key.startsWith('/')) ? key : `/${key}`;
            _nodeModuleResourceIdMap[resource] = `${moduleKey}${key}`;
        });
    }
}
/**
 *  Find the path to a modules resource relative to the webpack
 *  resolve module paths
 *
 *  @param  {Webpack.Module} module The module to get the relative path
 *  @param  {string[]} paths The webpack resolver module paths
 *
 *  @return {string|null} The relative path if available, null otherwise
 */
function getRelativeModule(module, paths) {
    if (!module || !module.resource || !paths || !paths.length) {
        return null;
    }
    // Try to find the module in the resolver paths
    for (let i = 0, len = paths.length; i < len; i++) {
        const relative = path.relative(paths[i], module.resource);
        if (!relative.startsWith('..')) {
            return relative;
        }
    }
    // Nothing relative
    return null;
}
/**
 *  Find the path to a modules resource relative to webpack aliases
 *
 *  @param  {Webpack.Module} module The module to alias
 *  @param  {[{ [key: string]: string }|null} aliases The webpack aliases
 *
 *  @return {string|null} The alias path if available, null otherwise
 */
function getAliasModule(module, aliases) {
    if (!module || !module.resource || !aliases || !Object.keys(aliases).length) {
        return null;
    }
    // Look for the module in each alias
    for (let alias in aliases) {
        const relative = path.relative(path.resolve(aliases[alias]), module.resource);
        if (relative.startsWith('..')) {
            continue;
        }
        // Absolute alias?
        alias = alias.replace(/\$$/, '');
        return (relative && relative.length) ? `${alias}/${relative}` : alias;
    }
    // Nothing aliased
    return null;
}
/**
 *  Get the module id based on its resource
 *
 *  @param  {Webpack.Module} module The module to get the id for
 *  @param  {string[]} paths The webpack resolver module paths
 *  @param  {[{ [key: string]: string }]|null} aliases The webpack aliases
 *
 *  @return {string|null} The module id if available, null otherwise
 */
function getModuleId(module, paths, aliases) {
    if (!module) {
        return null;
    }
    // Handling module ids can be a bit tricky
    // Modules can be included in any of the following ways:
    //   import { Module } from 'module'
    //                          'module/submodule'
    //                          './module'
    //                          'folder/module'
    //                          'alias/folder/module'
    //                          'alias$'
    //                          '@scope/module'
    //
    //   @decorator(PLATFORM.moduleName('module'))
    //                                  ...
    //
    // The problem arises when aurelia-loader has to know the module to use at runtime.
    // Webpack Mappings:
    //   Absolute Module: 'module' -> 'module'
    //   Relative Module: './module' -> 'folder/module'
    //   Absolute Path: 'folder/module' -> 'folder/module'
    //   Aliased Path: 'alias/folder/module' -> 'alias/folder/module'
    //   Absolute Alias Path: 'alias$' -> 'alias$'
    //
    // In order to have the aurelia-loader work correctly, we need to coerce everything to absolute ids
    // Is it a node_module?
    if (isNodeModule(module)) {
        return _nodeModuleResourceIdMap[module.resource];
    }
    // Get the module relative to the webpack resolver paths
    let moduleId = getRelativeModule(module, paths);
    // Fallback to parsing aliases if needed
    return (moduleId) ? moduleId : getAliasModule(module, aliases);
}
/**
 *  Escape a string to pass to a regular expression
 *
 *  @param  {string} str The string to escape
 *
 *  @return {string|null} The escaped string
 */
function escapeString(str) {
    if (typeof str !== 'string') {
        return null;
    }
    return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}
