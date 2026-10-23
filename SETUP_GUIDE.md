# 國小中年級導師 LINE 專屬智慧助教系統｜完整建置與設定指南

本指南專為國小導師設計，指引您將 **LINE 官方帳號**、**Google Apps Script (GAS)**、**Google 試算表** 與 **Google Gemini 多模態 API** 完美串接。

---

## 🎯 系統架構一覽

```
[老師手機 LINE 官方帳號]
        │
        ▼ (Webhook / 相片 / 文字)
[Google Apps Script (Web App)]
   ├── 🧠 Gemini 2.5 Flash (多模態發票收據辨識 / 學生衝突事件解析 / 備課錦囊)
   ├── 🤖 RDQ 復盤引擎 (下班 17:00 自動訪談 3 題，收斂當日狀況)
   ├── ⏰ 定時排程 Trigger (晨間 07:00 課表推播 / 傍晚 17:00 訪談觸發)
   └── 📊 Google 試算表資料庫 (課表、行事曆、班費收支、學生突發、每日待辦)
        │
        ▼ (doGet 網頁服務)
[個人儀表板 (響應式網頁)]
```

---

## 🛠️ 第一階段：取得 LINE 開發者憑證與設定 Webhook

如果您已經有 LINE 官方帳號（可在 [LINE Official Account Manager](https://manager.line.biz/) 登入），請依以下步驟啟用 Messaging API：

### 步驟 1.1：啟用 Messaging API
1. 登入 [LINE Official Account Manager](https://manager.line.biz/)。
2. 點選您的官方帳號，進入右上角 **「設定」**（齒輪圖示）。
3. 左側選單點選 **「Messaging API」**。
4. 點擊 **「啟用 Messaging API」**。
5. 填寫提供者（Provider）名稱（例如：`我的教學助手`），依畫面指引完成綁定。

### 步驟 1.2：進入 LINE Developers 取得金鑰
1. 開啟 [LINE Developers Console](https://developers.line.biz/console/)。
2. 找到剛才建立的 Channel（通道）。
3. **取得 Channel Secret**：
   - 點選 **「Basic settings」** 分頁。
   - 向下滾動找到 `Channel secret`，點擊複製並保存。
4. **取得 Channel Access Token**：
   - 點選 **「Messaging API」** 分頁。
   - 向下滾動到最底部找到 `Channel access token`。
   - 點擊 **「Issue」**（發行），將長字串 Token 複製並保存。

### 步驟 1.3：調整 LINE 官方帳號回應模式
為避免 LINE 預設的自動回覆干擾機器人，請前往：
1. [LINE Official Account Manager](https://manager.line.biz/) -> 右上角 **「設定」** -> **「回應設定」**。
2. **回應模式**：選擇 **「聊天室」** 或 **「Bot」**。
3. **Webhook**：勾選 **「開啟」**。
4. **自動回應訊息**：設定為 **「停用」**。

---

## 🔑 第二階段：免費取得 Google Gemini API Key

Gemini API 提供免費呼叫額度，足以應付每日教學相片 OCR 與自然語言解析：

1. 開啟 [Google AI Studio API Keys 頁面](https://aistudio.google.com/app/apikey)。
2. 使用您的 Google 帳號登入。
3. 點選 **「Create API key」**（建立 API 金鑰）。
4. 選擇既有的 Google Cloud 專案或快速建立新專案。
5. 複製生成的 API Key（以 `AIza...` 開頭）並妥善保存。

---

## 📑 第三階段：建立 Google 試算表與部署 Apps Script

### 步驟 3.1：建立試算表
1. 前往 [Google 雲端硬碟](https://drive.google.com/) 或 [Google Sheets](https://sheets.google.com)。
2. 建立一份新的試算表，命名為：`三年級班級管理資料庫`。

### 步驟 3.2：開啟 Apps Script 編輯器
1. 在試算表上方工具列，點選 **「擴充功能」** -> **「Apps Script」**。
2. 將左側的 `程式碼.gs` 內容全部刪除，貼上本專案的 [`Code.gs`](file:///Users/tunyuan/Library/CloudStorage/GoogleDrive-asc103138@st.tc.edu.tw/我的雲端硬碟/line待辦事項/Code.gs) 完整程式碼。
3. 點擊左側檔案旁的 **「＋」** 號，選擇 **「HTML」**，將檔案命名為 **`dashboard`**（不需加 .html）。
4. 貼上本專案的 [`dashboard.html`](file:///Users/tunyuan/Library/CloudStorage/GoogleDrive-asc103138@st.tc.edu.tw/我的雲端硬碟/line待辦事項/dashboard.html) 完整程式碼。
5. 點擊上方磁碟機圖示 **「儲存」**（Ctrl+S / Cmd+S）。

### 步驟 3.3：一鍵初始化資料表
1. 在 Apps Script 上方函式選單中，選擇 **`initSystemSheets`**。
2. 點擊 **「執行」**。
3. 首次執行會彈出「需要授權」視窗：
   - 點擊「查看權限」-> 選擇您的 Google 帳號。
   - 若出現「Google 尚未驗證這個應用程式」，點擊左下角「進階」-> 點擊「前往『...』(安全)」。
   - 點擊「允許」。
4. 執行完畢後，回到試算表，您會看到系統已自動建置好：
   - `課表`（已附上示範課表）
   - `學校行事曆`（可填入貴校行事）
   - `班費收支`
   - `學生突發`
   - `每日待辦`
   - `RDQ暫存`

### 步驟 3.4：設定安全金鑰（指令碼屬性）
1. 在 Apps Script 左側邊欄，點選 ⚙️ **「專案設定」**。
2. 向下滾動到 **「指令碼屬性」**，點選「新增指令碼屬性」，依序加入：
   - `CHANNEL_ACCESS_TOKEN`：貼入您的 LINE Channel Access Token
   - `CHANNEL_SECRET`：貼入您的 LINE Channel Secret
   - `GEMINI_API_KEY`：貼入您的 Gemini API Key
3. 點擊「儲存指令碼屬性」。

### 步驟 3.5：正式部署為 Web 應用程式
1. 點擊右上角藍色按鈕 **「部署」** -> **「新增部署」**。
2. 點選齒輪圖示，選擇 **「網頁應用程式」**。
3. 填寫部署資訊：
   - **說明**：`v1.0 LINE 國小導師智慧系統`
   - **執行身分**：選擇 **「我」**（您的 Google 帳號）
   - **誰可以存取**：務必選擇 **「所有人 (Anyone)」**（這樣 LINE 伺服器才能發送 Webhook）
4. 點擊 **「部署」**。
5. 複製生成的 **網頁應用程式網址 (Web App URL)**（格式為 `https://script.google.com/macros/s/.../exec`）。

### 步驟 3.6：將網址填入 LINE Developers
1. 回到 [LINE Developers Console](https://developers.line.biz/console/) 您的 Channel。
2. 進入 **「Messaging API」** 分頁。
3. 找到 **Webhook URL**，點擊「Edit」，貼上剛才複製的 Web App URL。
4. 點擊 **「Verify」**（驗證），出現 **Success** 即代表連線成功！
5. 確認將 **Use webhook** 開關切換為 **開啟 (綠色)**。

---

## ⏰ 第四階段：設定每日自動排程 (Triggers)

本系統支援每天早晨主動提議今日安排、晚間主動發動復盤診斷並規劃明日行程：

1. 在 Apps Script 編輯器左側選單，點選 ⏰ **「觸發條件」**（Triggers）。
2. 點擊右下角 **「+ 新增觸發條件」**：

   **【早晨 06:30 課程安排建議與臨時交辦確認】**：
   - 執行的功能：選擇 `sendMorningInteractiveBriefing`（或相容名 `sendMorningBriefing`）
   - 活動來源：選擇 `時間驅動`
   - 觸發條件類型：選擇 `日計時器`
   - 選取時段：選擇 `上午 6:00 至 7:00`（GAS 會於早晨 06:30 左右主動推播 3 套建議方案供點選）
   - 點擊儲存。

   **【晚間 20:00 復盤診斷與明日行程主動規劃】**：
   - 點擊右下角「+ 新增觸發條件」
   - 執行的功能：選擇 `triggerEveningInteractiveReview`（或相容名 `triggerEveningRDQ`）
   - 活動來源：選擇 `時間驅動`
   - 觸發條件類型：選擇 `日計時器`
   - 選取時段：選擇 `下午 8:00 至 9:00`（GAS 會於晚間 20:00 左右主動發送診斷選項，一鍵排定明日早自修至第七節）
   - 點擊儲存。

---

## 📱 第五階段：設定 LINE 圖文選單 (Rich Menu)

您可以直接使用 [LINE Official Account Manager](https://manager.line.biz/) 的官方介面輕鬆建立 6 格選單：

1. 登入 [LINE Official Account Manager](https://manager.line.biz/)。
2. 左側選單點選 **「圖文選單」** -> **「建立圖文選單」**。
3. **版型選擇**：選擇 **大型版型** 的 **「6 格」**（上 3 格、下 3 格）。
4. **各動作設定**（動作類型皆選 **「文字」**）：
   - **區域 A（左上）**：文字填入 `今日行程`
   - **區域 B（中上）**：文字填入 `下班復盤`
   - **區域 C（右上）**：文字填入 `快速備課`
   - **區域 D（左下）**：文字填入 `班費收支`
   - **區域 E（中下）**：文字填入 `學生突發`
   - **區域 F（右下）**：文字填入 `個人儀表板`
5. 上傳選單底圖（可參考本專案生成的底圖或自訂配圖）。
6. 點擊「儲存」並將狀態設為「使用中」。

---

## 🎒 第六階段：課表與行事曆設定

在您的 Google 試算表中：
1. **`課表` 分頁**：
   - 欄位包含：`星期`、`節次`、`科目`、`課型`。
   - `星期` 請填寫單字（例如：`一`、`二`、`三`、`四`、`五`）。
   - `課型` 填入 `導師課` 或 `科任課`（系統會針對導師課提供具體進度建議，科任課提醒帶隊與工具）。
2. **`學校行事曆` 分頁**：
   - 欄位包含：`日期`、`行事名稱`、`注意事項`。
   - 日期格式請統一為 `YYYY-MM-DD`（如 `2026-10-22`）。
   - 只要有填寫當天日期，系統早晨推播與下班建議都會主動參考納入！

---

## 💡 日常使用操作指南

1. **下班 RDQ 復盤**：
   - 每天 17:00 機器人會主動推播提醒。
   - 點擊「下班RDQ」或輸入「開始復盤」，依序回答 3 題（進度、學生、作業）。
   - 回答完畢後約 5 秒，Gemini 會結合課表自動產生明日早自習至第七節的清單！
2. **拍照自動記帳**：
   - 購買班級文具、教材或點心後，直接拍照傳入官方帳號。
   - Gemini 會自動 OCR 辨識廠商、品項、分類與金額，自動寫入「班費收支」並計算結餘。
3. **隨手記突發事件**：
   - 課間若有學生衝突、受傷或家長聯繫，直接以語音或文字傳給官方帳號。
   - 系統自動歸檔至「學生突發」分頁，並立即為您產出客製的親師說明簡訊草稿。
4. **個人儀表板**：
   - 在 LINE 點選「個人儀表板」，即可在瀏覽器查看清晰明瞭的卡片式後台！
