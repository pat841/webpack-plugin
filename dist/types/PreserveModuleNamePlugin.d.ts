/**
 *  The purpose of this plugin is to track down where exactly each included dependency lives and build a module
 *  name from that. Since projects and webpack configurations can be vary, we do our best to guess but expect edge-cases
 *  to be hit and changes needed.
 *
 *  Process:
 *  - Each AureliaDependency contains the preserveModuleName symbol to notify this plugin to track the dependency
 *  - AureliaDependenciesPlugin searches and includes all PLATFORM.moduleName() dependencies  and stores as
 *    an AureliaDependency
 *  - ConventionDependenciesPlugin searches for all relative includes and stores as an AureliaDependency
 *  - At this point, webpack has resolved all included modules regardless of using a relative or absolute path
 *  - Now we want to normalize each include so that we can reliably replace the include string to match the webpacks
 *    module id
 *  - We then unwrap all the modules from ModuleConcatenationPlugin to get the raw dependencies
 *  - For each raw dependency that is included via node_modules/, read from its location:
 *      - Example Path: /home/usr/pkg/node_modules/mod/dir/file.js
 *          - The path to the module itself: /home/usr/pkg/node_modules
 *          - The module name: mod
 *          - The relative path: dir/file.js
 *      - Map the parsed path data to nodeModuleResourcesMap by the parsed module name and its resource location
 *          - Example Map:
 *              {
 *                'aurelia-templating-router': {
 *                  '/home/usr/pkg/node_modules/aurelia-templating-router/dist/native-modules/router-view.js': {
 *                    path: '/home/usr/pkg/node_modules/aurelia-templating-router',
 *                    name: 'aurelia-templating-router',
 *                    relative: '/dist/native-modules/router-view.js',
 *                  },
 *                  '/home/usr/pkg/node_modules/aurelia-templating-router/dist/native-modules/route-href.js': {
 *                    path: '/home/usr/pkg/node_modules/aurelia-templating-router',
 *                    name: 'aurelia-templating-router',
 *                    relative: '/dist/native-modules/route-href.js',
 *                  },
 *                  '/home/usr/pkg/node_modules/aurelia-templating-router/dist/native-modules/aurelia-templating-router.js': {
 *                    path: '/home/usr/pkg/node_modules/aurelia-templating-router',
 *                    name: 'aurelia-templating-router',
 *                    relative: '/dist/native-modules/aurelia-templating-router.js',
 *                  },
 *                  '/home/usr/pkg/node_modules/aurelia-templating-router/dist/native-modules/route-loader.js': {
 *                    path: '/home/usr/pkg/node_modules/aurelia-templating-router',
 *                    name: 'aurelia-templating-router',
 *                    relative: '/dist/native-modules/route-loader.js',
 *                  },
 *                }
 *              }
 *  - For each mapped node_module, look at the included resources and normalize:
 *      - Look at the modules included resources and find a common path and its entry point
 *          - Entry point conditions:
 *              - Resource name matches 'index'
 *              OR Resource name matches the module name
 *              OR It is the only included module resource
 *          - If there are multiple entry points:
 *              - Pick the most shallow resource
 *              - If they are both as shallow as possible choose index over module name match
 *      - Map the normalized module id to nodeModuleResourceIdMap by the resource file
 *          - Example Map:
 *              {
 *                '/home/usr/pkg/node_modules/aurelia-templating-router/dist/native-modules/router-view.js': 'aurelia-templating-router/router-view.js',
 *                '/home/usr/pkg/node_modules/aurelia-templating-router/dist/native-modules/route-href.js': 'aurelia-templating-router/route-href.js',
 *                '/home/usr/pkg/node_modules/aurelia-templating-router/dist/native-modules/aurelia-templating-router.js': 'aurelia-templating-router',
 *                '/home/usr/pkg/node_modules/aurelia-templating-router/dist/native-modules/route-loader.js': 'aurelia-templating-router/route-loader.js',
 *              }
 *  - Look at all webpack modules and for each module that includes or has a dependency that includes an AureliaDependency:
 *      - Handling module ids can be a bit tricky. Modules can be included in any of the following ways:
 *          import { Module } from 'module'
 *                                 'module/submodule'
 *                                 './module'
 *                                 'folder/module'
 *                                 'alias/folder/module'
 *                                 'alias$'
 *                                 '@scope/module'
 *          @decorator(PLATFORM.moduleName('module'))
 *                                 ...
 *      - The problem arises when aurelia-loader has to know the module to use at runtime. Webpack Mappings:
 *          - Absolute Module: 'module' -> 'module'
 *          - Relative Module: './module' -> 'folder/module'
 *          - Absolute Path: 'folder/module' -> 'folder/module'
 *          - Aliased Path: 'alias/folder/module' -> 'alias/folder/module'
 *          - Absolute Alias Path: 'alias$' -> 'alias$'
 *      - In order to have the aurelia-loader work correctly, we need to coerce everything to normalized ids
 *          - If the module is in the node_module/ map, use the normalized module id
 *          - If the module exists inside a webpack resolver path, use the relative path as the module id
 *          - If the module exists inside a webpack alias path, use the relative path from the alias path as the module id
 *      - Set the modules preserveModuleName Symbol export so the AureliaDependenciesPlugin can read it later
 *  - In AureliaDependenciesPlugin, for each AureliaDependency, replace the original and now incorrect PLATFORM.moduleName()
 *    path with the normalized path.
 *  - Source files now contain the normalized module paths with map correctly to the webpack module ids so that the
 *    aurelia-loader can find them during runtime.
 */
import * as Webpack from "webpack";
export declare const preserveModuleName: unique symbol;
export declare class PreserveModuleNamePlugin {
    private isDll;
    constructor(isDll?: boolean);
    apply(compiler: Webpack.Compiler): void;
}
/**
 *  END: Module resolution functions
 */
