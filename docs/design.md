# 观星的设计

核心体验是进入一幅星景、生成自己的命盘、选一个问题继续了解。页面围绕这条路径组织，而不是用功能卡片堆叠出一个通用仪表盘。

## v3.1：封面、命盘与解读共用一个视觉系统

2026-10-30，按用户知识库 GitHub 热点记录中的设计项目重新审视界面。阅读 [Hallmark](https://github.com/Nutlope/hallmark/tree/main/skills/hallmark)、[Impeccable](https://github.com/pbakaus/impeccable)、[AI Design Skills](https://github.com/elayadesign/ai-design-skills/tree/main/skills/landing-page-design)、[Taste Skill](https://github.com/Leonxlnx/taste-skill/tree/main/skills/taste-skill) 的设计与审阅规则作为参考，没有安装其 CLI 或复制模板代码。

- 保留项目自己的夜色山水、中文宋体标题、黄铜色星盘，不随机换主题。封面只承担进入排盘的主要动作。
- 去掉解读区的米白面板、绿色按钮和多余英文眉题。命盘、阅读区、弹窗与后台共用墨蓝背景、灰白正文、金色重点与细线控件。
- 一张山水贯穿用户页面。解读面板只加低透明度遮罩保证文字可读，不用另一整块颜色切断场景。AI 正文使用易读的正文体，标题与重点沿用星图色彩。
- 首页为实时动态场景：原有山水、旋转星盘、逐渐展开的星座线、远处流星，加低分辨率 WebGL 云雾。无需下载视频；不支持 WebGL 时保留背景和星盘。支持暂停及减少动态效果。
- 命盘和对话在桌面并排；手机一次看一个区域，顶部切换。历史记录恢复原命盘，用户无需接触 Agent、工具循环或模型账本。
- 后台按实际工作组织为模型、用量、账号、站点管理；用真实账本展示数据，沿用品牌颜色但减少场景装饰。

本次按这些项目的原则做设计判断，并使用项目自己的 React/CSS/Canvas 实现和浏览器验收；没有宣称通过外部 CLI 的完整检查。

## 视觉方向

- 用贯穿屏幕的场景建立空间感，让文字与控件成为场景中的清晰前景。
- 以中文标题、细线、星曜和十二宫结构形成自己的视觉语言。
- 保留足够留白；重要操作靠位置和层级识别，不靠每个按钮都发光。
- 动效围绕场景与反馈服务，提供暂停入口，并尊重系统的减少动态设置。
- 在窄屏保留完整操作路径，避免必须横向拖动才能填写信息。

## 参考

[Lusion](https://lusion.co/) 提供了用整幅场景组织网页的参考。[Hallmark](https://github.com/Nutlope/hallmark)、[Impeccable](https://github.com/pbakaus/impeccable) 与 [AI Design Skills](https://github.com/elayadesign/ai-design-skills) 提供去除模板感、建立排版层级与细化交互的参考。

这些参考用于设计判断；不复制其页面、图片、视频或品牌资产。背景为本项目创作的插画，界面与交互按紫微命盘的使用场景实现。

## 与 XINGLABS 的关系

观星作为独立项目发布。XINGLABS 个人主页保留原有全屏动态视觉，在作品区提供体验与源码入口，使主页展示和实际应用各自保持简单。
