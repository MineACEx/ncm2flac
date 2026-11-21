# NCM → FLAC / MP3

纯浏览器端网易云音乐 `.ncm` 转换工具。所有解密与编码都在本地完成，文件不上传任何服务器。

## 特性

- **无损路径**：直接还原 NCM 内的原始 FLAC / MP3 流，逐字节搬运，不做解码与重编码，音质零损失
- **MP3 转码**：128 / 192 / 256 / 320 kbps 四档，另有一个 **320 kbps 极限档**（LAME quality 0）
- **元数据**：自动写入标题 / 艺术家 / 专辑与封面（FLAC 用 Vorbis Comment + PICTURE 块，MP3 用 ID3v2.3 + APIC）
- **批量**：支持多文件拖入，逐个转换
- **G2 连续曲率圆角**：卡片角部用超椭圆而非圆弧，曲率从直边 0 平滑过渡到角部峰值
- **零依赖后端**：单个静态站点，可直接托管在 GitHub Pages

## 原理

```
NCM 容器
├─ 8 字节魔数 CTENFDAM
├─ AES-128-ECB 加密的 RC4 密钥表  →  XOR 0x64 → AES 解密 → 去掉前缀 neteasecloudmusic
├─ AES-128-ECB 加密的元数据        →  XOR 0x63 → 去 base64 → AES 解密 → JSON
├─ CRC32 + 段间隔
├─ JPEG 封面（长度字段在其前 4 字节，小端）
└─ RC4 加扰的音频流               →  用上面的密钥表跑 KSA / PRGA 逐字节还原
```

音频部分不解码，因此还原出的 FLAC 与源文件逐字节一致；已用 PCM MD5 交叉验证。

## MP3 音质说明

MP3 规范的码率硬上限就是 **320 kbps**，再往上没有合法档位。想继续提升只能靠编码器的心理声学精度，
所以这里额外暴露了 LAME 的 `quality` 档：

| 选项 | 码率 | LAME quality | 说明 |
|---|---|---|---|
| 320 kbps · 标准 | 320 | 3 | 常规速度 |
| 320 kbps · 极限 | 320 | 0 | 最精细的噪声整形与比特分配，耗时约 +55% |

实测同一段 109 秒素材：标准档 32.9 秒、极限档 51.8 秒，两者输出字节完全不同（MD5 不同），
极限档在复杂段落分配的比特更多。文件总大小相同——因为 CBR 是定长帧。

## G2 圆角

普通 `border-radius` 只保证 G1（切线连续），曲率在「直线→圆弧」接缝处从 0 跳到 1/r，这是"生硬"的来源。
本项目用超椭圆（Lamé 曲线）代替圆弧：

- **原生路径**：`corner-shape: superellipse(4)`（Chrome 139+），零成本
- **兜底路径**：`squircle.js` 用 `clip-path: path()` 按极坐标公式 `rho = r/(|cosφ|^n+|sinφ|^n)^(1/n)` 采样，
  `n=4`、每角 44 段，并用 `ResizeObserver` 跟随尺寸重算
- `border-radius` 始终保留，作为两条路径都不可用时的最终回退

## 本地运行

任何静态服务器即可，例如：

```bash
npx serve .
```

直接双击 `index.html` 也能用（脚本全部是普通 `<script>`，不涉及模块跨域）。

## 浏览器要求

需要支持 `OfflineAudioContext.decodeAudioData` 对 FLAC 的解码（Chrome / Edge / Safari 16+ / Firefox 均可）。
转 MP3 时建议用 44.1kHz 或 48kHz 源，其他采样率会被重采样到最近的 LAME 标准采样率。

## 许可

仅供转换你已合法获取的本地文件。
