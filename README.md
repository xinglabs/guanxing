# 观星 · 紫微

**把古老的星图，变成一次认识自己的对话。**

Guanxing 是 XINGLABS 的开源紫微斗数应用：一幅铺满屏幕的动态星景，一张在浏览器本地生成的十二宫命盘，以及由你选择的模型提供的解读。

[打开观星](https://xinglabs.github.io/guanxing/) · [XINGLABS](https://xinglabs.github.io/) · [上游排盘引擎](https://github.com/Renhuai123/ziwei-doushu)

![观星桌面预览](docs/preview-desktop.png)

## 使用

1. 输入公历出生日期、时辰和排盘使用的性别，生成命盘；也可以先打开示例。
2. 查看十二宫、主星和四化，选择想了解的宫位。
3. 需要 AI 解读时，填入自己的 OpenAI-compatible 服务地址、模型名和 API Key，再提出问题。排盘本身不需要 Key。

AI 是可选功能。浏览器直接向所选服务发出请求，因此服务必须允许跨域请求（CORS）。模型调用费用与数据处理遵循该服务的条款；项目不提供共享密钥或免费模型额度。

## 本地运行

使用 Node.js 22 或更新的兼容版本：

```bash
npm ci
npm run dev
```

```bash
npm test
npm run build
npm run preview
```

技术栈为 React、TypeScript 和 Vite，产物是静态文件，可部署到 GitHub Pages 等静态托管服务。

## 数据与解读

出生信息在当前浏览器中用于排盘。只有主动发起 AI 解读时，应用才将十二宫、星曜信息和所填问题直接发送给用户选择的模型服务；请求不附带称呼或完整出生日期。请避免在问题里填写不必要的个人信息。

API Key 仅存于当前页面内存，不写入 URL、Cookie 或浏览器持久化存储，刷新即清除。完整说明见 [数据流与隐私](docs/privacy.md)。

本项目将紫微斗数作为传统文化、娱乐与自我观察的素材，不将命盘或 AI 输出视为科学预测。不同流派的排盘与解释可能不同；生成文字也可能有误。实际选择应结合可验证的事实与自己的判断。

### 排盘口径

- 公历输入，支持 1900—2100 年；选择的是地支时辰，不是 24 小时制钟点。
- 使用上游默认的全书亮度表，闰月按分半规则处理。
- 不自动校正真太阳时、时区或夏令时。
- 子时序号为 0；若采用晚子时换日口径，23 点出生请将排盘日期选为次日。

## 发布到 GitHub Pages

仓库包含 [Pages workflow](.github/workflows/pages.yml)。在仓库的 **Settings → Pages → Source** 选择 **GitHub Actions**，推送到 `main` 后会依次执行依赖安装、测试、构建并发布 `dist/`。

默认项目地址为 `https://xinglabs.github.io/guanxing/`。更改仓库名或改用根域名时，请同步调整 Vite 的 `base` 配置与 README 中的链接。

## 来源与设计

真实排盘逻辑来自 [Renhuai123/ziwei-doushu](https://github.com/Renhuai123/ziwei-doushu)，保留 MIT 授权。此项目没有打包上游的非商业讲义语料或解释数据集。

视觉参考 Lusion 的沉浸式场景，以及 Hallmark、Impeccable、AI Design Skills 关于排版、视觉层级和克制交互的思路。相关网站的图片、视频与品牌资产未复制到项目。详见 [设计说明](docs/design.md) 和 [第三方说明](THIRD_PARTY_NOTICES.md)。

## License

新编写的代码采用 [MIT License](LICENSE)。上游文件与依赖保留各自的版权和授权，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
