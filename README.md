# DeepSeek Harness Code — Electron 客户端

Electron 桌面客户端基础骨架，**TypeScript** 编写。设计原则：**单一职责**、**分治**、**单文件不过长**。
不引入打包器，用 `tsc` 项目引用分治编译，保持结构透明、零魔法。

## 快速开始

```bash
npm install
npm start        # 编译 + 启动
npm run build    # 仅编译（含完整类型检查）
```

## 构建结构

两个独立的编译单元（`tsconfig.json` 以项目引用聚合）：

| 项目 | 覆盖范围 | 模块格式 | 输出 |
|---|---|---|---|
| `tsconfig.main.json` | `src/main` `src/preload` `src/shared` | CommonJS（Node16 解析） | `out/main` `out/preload` `out/shared` |
| `tsconfig.renderer.json` | `src/renderer` + `src/shared/bridge.d.ts` | ES Module（浏览器直载） | `out/renderer` |

HTML / CSS 等静态资源由 `scripts/copy-static-assets.mjs` 复制到 `out/renderer`
（renderer 下新增静态目录时在该脚本登记一行）。Electron 入口为 `out/main/index.js`。

## 架构总览

```
src/
├── main/                    主进程（Node.js 环境）
│   ├── index.ts             组合根：只做模块组装与依赖注入
│   ├── lifecycle.ts         应用生命周期：单实例锁、启动时机、退出策略
│   ├── config/
│   │   └── app-config.ts    静态配置常量（窗口尺寸、入口文件路径等）
│   ├── windows/
│   │   ├── main-window.ts   主窗口工厂：窗口配置 + 安全选项 + 页面加载
│   │   └── window-manager.ts 窗口管理器：登记 / 查询 / 聚焦 / 销毁
│   └── ipc/
│       ├── index.ts         IPC 注册中心：所有通道注册的唯一入口
│       ├── app-handlers.ts  应用域通道（版本查询、退出）
│       └── window-handlers.ts 窗口域通道（最小化、最大化/还原、关闭）
├── preload/
│   └── index.ts             contextBridge 桥：按白名单暴露 window.api
├── shared/
│   ├── channels.ts          IPC 通道契约：通道常量 + 字面量联合类型
│   └── bridge.d.ts          ElectronBridge 接口：preload 与渲染层共用的类型契约
└── renderer/                渲染进程（纯浏览器环境，无 Node 能力）
    ├── index.html
    ├── global.d.ts          为 Window.api 声明类型（引用 ElectronBridge）
    ├── styles/main.css
    └── scripts/
        ├── main.ts          渲染层入口：只做组装
        ├── api.ts           window.api 的薄封装与防御检查
        ├── app-info.ts      应用信息展示（版本号）
        └── window-controls.ts 标题栏按钮与窗口操作绑定
```

## 职责边界

| 层 | 职责 | 明确不做的事 |
|---|---|---|
| `main/index.ts` | 组装各模块 | 不含业务逻辑 |
| `lifecycle.ts` | 决定"什么时候做什么" | 不创建窗口细节、不注册通道（依赖注入的最小接口 `ManagedWindows`） |
| `main-window.ts` | 描述单个窗口的样子 | 不管理窗口集合 |
| `window-manager.ts` | 管理窗口集合 | 不关心单个窗口配置 |
| `ipc/*-handlers.ts` | 各自领域的通道处理 | 不持有窗口管理器引用 |
| `preload` | 暴露安全 API 白名单 | 不透出 ipcRenderer |
| `renderer` | 界面与交互 | 不直接使用通道字符串 |

类型层面的分治：`shared/channels.ts` 导出通道字面量联合（`IpcChannel`），
`shared/bridge.d.ts` 定义 `ElectronBridge`——preload 用它约束暴露内容，
渲染层用它获得 `window.api` 的类型提示，两端契约同源、防止漂移。
跨层类型引用一律使用 `import type`，编译产物中不会产生多余的 require。

安全基线：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、页面带 CSP。

## 如何扩展

**新增一个 IPC 能力（三步）：**

1. `src/shared/channels.ts` 增加通道常量（联合类型自动收录）；
2. 对应领域的 `*-handlers.ts` 新增 `ipcMain.handle`（新领域则新建文件并在 `ipc/index.ts` 挂载）；
3. `src/shared/bridge.d.ts` 补充方法签名 → `src/preload/index.ts` 实现 → 渲染层经 `renderer/scripts/api.ts` 调用。

**新增一种窗口：**

1. 在 `src/main/windows/` 下新建 `xxx-window.ts` 工厂函数；
2. 在 `window-manager.ts` 增加对应的创建方法；
3. 在合适的时机（如某个 IPC handler 或生命周期回调）调用它。

**新增 renderer 静态资源：** 放入 `src/renderer`（子目录）并在
`scripts/copy-static-assets.mjs` 登记复制规则。
