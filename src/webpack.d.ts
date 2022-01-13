// @ts-ignore
declare module "html-loader/lib/attributesParser" {
  function parse(content: string, cb: (tag: string, attr: string) => boolean): { value: string }[];

  export = parse;
}

declare namespace NodeModule {
  interface ModuleResource {
    [key: string]: Data;
  }

  interface ResourcesMap {
    [key: string]: ModuleResource;
  }

  interface ResourceIdMap {
    [key: string]: string;
  }

  interface Data {
    path: string;
    name: string;
    relative: string;
  }
}
