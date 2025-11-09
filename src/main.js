require("./ll_api/main.js");
require("./loader_core/plugin_loader.js");

const fs = require("fs");
const { MainLoader } = require("./loader_core/main.js");
const { protocolRegister } = require("./protocol_scheme/main.js");
const path = require("path");


const loader = new MainLoader().init();


function proxyBrowserWindowConstruct(target, argArray, newTarget) {
    const window = Reflect.construct(target, argArray, newTarget);

    // 监听send
    window.webContents.send = new Proxy(window.webContents.send, {
        apply(target, thisArg, [channel, ...args]) {
            if (channel.includes("RM_IPCFROM_")) {
                if (args?.[1]?.cmdName == "nodeIKernelSessionListener/onSessionInitComplete") {
                    loader.onLogin(args[1].payload.uid);
                }
            }
            return Reflect.apply(target, thisArg, [channel, ...args]);
        }
    });
    if (window.webContents._getPreloadScript) {
      const originalGetPreloadScript = window.webContents._getPreloadScript.bind(window.webContents);
      window.webContents._getPreloadScript = function () {
        const originalResult = originalGetPreloadScript();

        if (!originalResult || !originalResult.filePath) {
          return originalResult;
        }

        // 创建包装 preload 文件
        const filename = path.basename(originalResult.filePath, path.extname(originalResult.filePath));
        const wrapperPath = path.join(LiteLoader.path.root, `preload_wrapper_${filename}.js`);

        // 生成包装代码
        let wrapperCode = `// Preload wrapper - auto-generated\nconsole.log('[Wrapper] Loading preloads...');\n\n`;

        // 读取并内联原始 preload 源码
        try {
          const originalCode = fs.readFileSync(originalResult.filePath, 'utf8');
          wrapperCode += `// ===== Original Preload: ${path.basename(originalResult.filePath)} =====\n`;
          wrapperCode += `(function() {\ntry {\n${originalCode}\nconsole.log('[Wrapper] Original preload executed');\n} catch(e) {\nconsole.error('[Wrapper] Original preload error:', e);\n}\n})();\n\n`;
        } catch (err) {
          console.error('[Hook] Failed to read original preload:', err);
          wrapperCode += `console.error('[Wrapper] Could not load original preload');\n\n`;
        }

        // 读取并内联所有自定义 preload 源码
          try {
            const customCode = fs.readFileSync(path.join(LiteLoader.path.root, "src/preload.js"), 'utf8');
            wrapperCode += `(function() {\ntry {\n${customCode}\nconsole.log('[Wrapper] Custom preload executed');\n} catch(e) {\nconsole.error('[Wrapper] Custom preload error:', e);\n}\n})();\n\n`;
          } catch (err) {
            wrapperCode += `console.error('[Wrapper] Could not load preload ;\n\n`;
          }

        // 写入包装文件
        try {
          fs.writeFileSync(wrapperPath, wrapperCode, 'utf8');
          console.log(`[Hook] Created wrapper preload: ${wrapperPath}`);
        } catch (err) {
          console.error('[Hook] Failed to create wrapper preload:', err);
          return originalResult;
        }

        console.log('[Hook] Successfully hooked _getPreloadScript', wrapperPath);
        // 返回修改后的对象，指向包装文件
        return {
          ...originalResult,
          filePath: wrapperPath
        };
      };
    }

    // 加载Preload
    else {
        window.webContents._getPreloadPaths = new Proxy(window.webContents._getPreloadPaths, {
            apply(target, thisArg, argArray) {
                return [
                    ...Reflect.apply(target, thisArg, argArray),
                    path.join(LiteLoader.path.root, "src/preload.js")
                ];
            }
        });
    }

    // 加载自定义协议
    protocolRegister(window.webContents.session.protocol);

    // 加载插件
    loader.onBrowserWindowCreated(window);

    return window;
}


// 监听窗口创建
require.cache["electron"] = new Proxy(require.cache["electron"], {
    get(target, property, receiver) {
        const module = Reflect.get(target, property, receiver);
        return property != "exports" ? module : new Proxy(module, {
            get(target, property, receiver) {
                const exports = Reflect.get(target, property, receiver);
                return property != "BrowserWindow" ? exports : new Proxy(exports, {
                    construct: proxyBrowserWindowConstruct
                });
            }
        });
    }
});


if (!globalThis.qwqnt && !globalThis.PMHQ) {
    const main_path = "./application.asar/app_launcher/index.js";
    require(require("path").join(process.resourcesPath, "app", main_path));
    setImmediate(() => global.launcher.installPathPkgJson.main = main_path);
}