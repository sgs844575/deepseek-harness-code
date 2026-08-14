/**
 * 渲染进程可见的桥接 API 形状。
 * preload 用它约束暴露内容，渲染层用它声明 Window.api 类型，
 * 两端共用同一份类型定义，防止契约漂移。
 */
export interface ElectronBridge {
  app: {
    getVersion(): Promise<string>;
    quit(): Promise<void>;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
  };
}
