# NCM → FLAC / MP3

纯浏览器端网易云音乐 `.ncm` 转换工具。所有解密与编码都在本地完成，文件不上传任何服务器。

## 特性

- **无损路径**：直接还原 NCM 内的原始 FLAC / MP3 流，逐字节搬运，不做解码与重编码，音质零损失
- **MP3 转码**：可选 128 / 192 / 256 / 320 kbps，用 lamejs 在浏览器内编码，FLAC 源会被重采样到标准采样率
- **元数据**：自动写入标题 / 艺术家 / 专辑与封面（FLAC 用 Vorbis Comment + PICTURE 块，MP3 用 ID3v2.3 + APIC）
- **批量**：支持多文件拖入，逐个转换
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

## 本地运行

任何静态服务器即可，例如：

```bash
npx serve .
```

直接双击 `index.html` 也能用（脚本全部是普通 `<script>`，不涉及模块跨域）。

## 浏览器要求

需要支持 `OfflineAudioContext.decodeAudioData` 对 FLAC 的解码（Chrome / Edge / Safari 16+ / Firefox 均可）。转 MP3 时建议用 44.1kHz 或 48kHz 源，其他采样率会被重采样到最近的 LAME 标准采样率。

## 许可

仅供转换你已合法获取的本地文件。
