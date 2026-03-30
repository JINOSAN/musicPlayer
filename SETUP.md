# 🛠 Personal Music Player — セットアップ・インストールマニュアル

> 別の MacBook でアプリを動作させるための手順書  
> 所要時間: 約 10〜20 分

---

## 📋 目次

1. [必要な環境](#1-必要な環境)
2. [事前準備：ソースコードの転送](#2-事前準備ソースコードの転送)
3. [Step 1 — Homebrew のインストール](#step-1--homebrew-のインストール)
4. [Step 2 — Node.js のインストール](#step-2--nodejs-のインストール)
5. [Step 3 — アプリの依存パッケージインストール](#step-3--アプリの依存パッケージインストール)
6. [Step 4 — 起動確認](#step-4--起動確認)
7. [アップデート手順](#アップデート手順)
8. [アンインストール手順](#アンインストール手順)
9. [よくある問題と解決方法](#よくある問題と解決方法)

---

## 1. 必要な環境

| 項目 | 必要バージョン | 推奨バージョン |
|------|--------------|--------------|
| **OS** | macOS 10.15 (Catalina) 以降 | macOS 13 (Ventura) 以降 |
| **Node.js** | v18.0.0 以降 | **v20.18.0** |
| **npm** | v8.0.0 以降 | **v10.8.2** |
| **ディスク空き容量** | 500 MB 以上 | 1 GB 以上 |
| **インターネット接続** | 初回セットアップ時のみ必要 | — |

---

## 2. 事前準備：ソースコードの転送

元の MacBook からソースコードをコピーします。  
**以下のいずれかの方法**でコピーしてください。

### 方法 A — USB メモリ / 外付けドライブ

```
① 元の MacBook でプロジェクトフォルダを USB メモリにコピー
   コピー対象フォルダ:  musicplayer/
   ※ node_modules/ フォルダは不要（容量が大きいため除外可）

② 新しい MacBook に USB メモリを接続

③ 任意の場所にフォルダを配置（例: ~/Documents/musicplayer/）
```

### 方法 B — AirDrop

```
① 元の MacBook でプロジェクトフォルダを右クリック
② 「圧縮」して .zip ファイルを作成
③ AirDrop で新しい MacBook に送信
④ 受信後に展開（解凍）して任意の場所に配置
```

### 方法 C — Git（推奨）

プロジェクトが Git 管理されている場合:

```bash
# GitHub / GitLab 等からクローン
git clone https://github.com/あなたのアカウント/musicplayer.git
cd musicplayer
```

### ⚠️ 転送不要なフォルダ・ファイル

| 除外項目 | 理由 |
|---------|------|
| `node_modules/` | 新しい環境で再インストールするため |
| `.DS_Store` | macOS のシステムファイル（不要） |

---

## Step 1 — Homebrew のインストール

> **Homebrew** は macOS 向けのパッケージマネージャーです。  
> すでにインストール済みの場合はスキップしてください。

### インストール確認

```bash
brew --version
```

`Homebrew 4.x.x` のように表示されれば **インストール済み** です → [Step 2 へ](#step-2--nodejs-のインストール)

### 新規インストール

**Terminal.app** を開いて以下のコマンドを実行します。

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

インストール中にパスワードの入力を求められたら、**Mac のログインパスワード**を入力してください。

#### Apple Silicon (M1/M2/M3/M4) の Mac の場合

インストール完了後、以下のコマンドも実行してください：

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

#### インストール確認

```bash
brew --version
# → Homebrew 4.x.x と表示されればOK
```

---

## Step 2 — Node.js のインストール

### インストール確認

```bash
node --version
npm --version
```

`v18.x.x` 以上が表示されれば **インストール済み** です → [Step 3 へ](#step-3--アプリの依存パッケージインストール)

### 新規インストール（Homebrew 使用・推奨）

```bash
# Node.js v20 (LTS) をインストール
brew install node@20

# パスを通す（Apple Silicon Mac の場合）
echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile

# Intel Mac の場合
echo 'export PATH="/usr/local/opt/node@20/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile
```

### インストール確認

```bash
node --version
# → v20.x.x と表示されればOK

npm --version
# → 10.x.x と表示されればOK
```

---

## Step 3 — アプリの依存パッケージインストール

プロジェクトフォルダへ移動して、必要なパッケージをインストールします。

```bash
# プロジェクトフォルダへ移動（パスは実際の場所に合わせてください）
cd ~/Documents/musicplayer

# 依存パッケージをインストール（初回のみ・インターネット接続が必要）
npm install
```

**インストールされるパッケージ:**

| パッケージ | 用途 |
|-----------|------|
| `electron` v28 | デスクトップアプリフレームワーク |
| `music-metadata` v7 | 音楽ファイルのメタデータ読み取り |

> ⏱ インターネット速度によりますが、通常 **1〜5 分**程度かかります。

---

## Step 4 — 起動確認

```bash
# アプリを起動
npm start
```

🎵 アプリウィンドウが表示されれば **セットアップ完了** です！

### 開発モード（デバッグ用）

```bash
npm run dev
```

Chrome DevTools が利用可能になります。

---

## アップデート手順

元の MacBook でソースコードが更新された場合：

### 方法 A — ファイルを上書きコピー

```bash
# 1. 新しいソースファイルを上書きコピー後、依存パッケージを更新
cd ~/Documents/musicplayer
npm install

# 2. アプリを再起動
npm start
```

### 方法 B — Git を使っている場合

```bash
cd ~/Documents/musicplayer
git pull
npm install
npm start
```

---

## アンインストール手順

### アプリの削除

```bash
# プロジェクトフォルダごと削除
rm -rf ~/Documents/musicplayer
```

### Node.js の削除（不要な場合）

```bash
brew uninstall node@20
```

### Homebrew の削除（不要な場合）

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/uninstall.sh)"
```

---

## よくある問題と解決方法

### ❌ `npm install` でエラーが出る

```bash
# キャッシュをクリアして再試行
npm cache clean --force
rm -rf node_modules
npm install
```

### ❌ `brew: command not found`

Homebrew のパスが通っていません。以下を実行してください：

```bash
# Apple Silicon (M1/M2/M3/M4)
eval "$(/opt/homebrew/bin/brew shellenv)"

# Intel Mac
eval "$(/usr/local/bin/brew shellenv)"
```

### ❌ `node: command not found`

Node.js のパスが通っていません。以下を実行してください：

```bash
# Apple Silicon (M1/M2/M3/M4)
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"

# Intel Mac
export PATH="/usr/local/opt/node@20/bin:$PATH"
```

その後ターミナルを再起動して `node --version` を確認してください。

### ❌ `Error: Cannot find module 'electron'`

`node_modules` が正しくインストールされていません：

```bash
cd ~/Documents/musicplayer
rm -rf node_modules package-lock.json
npm install
```

### ❌ アプリが起動するが音が出ない

1. macOS の **システム環境設定 → サウンド** で出力デバイスを確認
2. アプリ内の **VOLUMEスライダー** が 0 になっていないか確認
3. 音楽ファイルをドロップして再生ボタンを押してみる

### ❌ `node_modules` のインストールに時間がかかる

Electron は約 **100〜200 MB** のダウンロードが発生します。ネットワーク速度が遅い場合は時間がかかることがあります。Wi-Fi の速度を確認してください。

### ❌ macOS のセキュリティ警告が出る

初回起動時に「開発元を確認できない」という警告が出る場合：

```
システム環境設定 → プライバシーとセキュリティ → 「このまま開く」をクリック
```

---

## 動作確認チェックリスト

セットアップ後、以下を順番に確認してください：

- [ ] `node --version` で `v18` 以上が表示される
- [ ] `npm --version` で `v8` 以上が表示される
- [ ] `npm install` がエラーなく完了する
- [ ] `npm start` でアプリウィンドウが開く
- [ ] 音楽ファイルをドロップしてプレイリストに追加できる
- [ ] 曲をクリックして再生できる
- [ ] レベルメーターが動作する（青/黄/赤の点灯）
- [ ] ビジュアライザーが7色で表示される
- [ ] 保存ボタンでプレイリストを保存できる

---

## 環境情報まとめ

| 項目 | 値 |
|------|-----|
| Node.js | v20.18.0 (推奨) |
| npm | v10.8.2 (推奨) |
| Electron | v28.x.x |
| music-metadata | v7.14.0 |
| 対応 macOS | 10.15 Catalina 以降 |

---

*Personal Music Player v1.0.0 — Setup Guide*
