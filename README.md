# 國小中年級導師 LINE 專屬智慧助教系統 (LINE Bot + GAS + Gemini 2.5 Flash)

專為臺灣國小中年級導師設計的日常教學、班級經營與行政減負助理。整合 LINE 官方帳號、Google Apps Script、Google 試算表與 Gemini 2.5/1.5 Flash 多模態 AI。

---

## 🌟 核心特色

1. **06:30 晨間主動安排與節次三選一提案**：
   - 每日 06:30 主動推播，精確到【早自修至第七節每一節課】皆給出 3 種具體教學建議（[A] 標準課本進度 / [B] 習作精練補救 / [C] 在地情境探究），導師可一鍵全選或節次微調，並隨時補充臨時交辦。
2. **20:00 晚間主動復盤與明日節次三選一規劃**：
   - 每日 20:00 自動推播，結合當日課程實際進度、今日突發紀錄、臨時交辦與明日課表行事，主動為【明日每一節課】提供 3 種課堂待辦建議供點選，一鍵產出明日早自修至第七節備課清單。
3. **彈性課務控制：臨時改進度 ＆ 重新設計進度**：
   - 支援隨時回傳「臨時改變進度」（例如第2節改上數學）即時重整當日清單。
   - 支援「重新設計進度」，AI 結合期中考倒數（11/05-11/06）與教材單元，自動產出三軌重整藍圖供導師對齊進度！
3. **拍照多模態 AI 記帳**：
   - 廠商收據、發票拍照即傳，Gemini 自動辨識廠商、品項、類別與金額，即時寫入試算表並計算結餘。
   - 預設班費基底：28 位學生，每生收費 300 元，總額 8,400 元。
4. **自然語言與學生突發事件速記**：
   - 支援隨意語音或文字速記學生受傷、衝突或常規事件。
   - 自動萃取人事物存入資料庫，並即時產出合乎教育法規與親師溝通的正向 LINE 簡訊草稿。
5. **網頁版導師個人儀表板**：
   - GAS Web App 原生渲染（Tailwind CSS），免安裝、免伺服器費用。
   - 即時顯示：今日節次待辦、今日作息、班費收支動態、近期突發事件追蹤。
6. **國小導師專用 6 格圖文選單**：
   - 【今日行程】、【下班RDQ】、【快速備課】、【班費收支】、【學生突發】、【個人儀表板】。

---

## 📂 專案檔案清單

- [`Code.gs`](file:///Users/tunyuan/Library/CloudStorage/GoogleDrive-asc103138@st.tc.edu.tw/我的雲端硬碟/line待辦事項/Code.gs)：Google Apps Script 後端程式碼（LINE Webhook、Gemini 呼叫、RDQ 狀態機、排程推播、資料庫存取）。
- [`dashboard.html`](file:///Users/tunyuan/Library/CloudStorage/GoogleDrive-asc103138@st.tc.edu.tw/我的雲端硬碟/line待辦事項/dashboard.html)：響應式導師個人儀表板前端。
- [`SETUP_GUIDE.md`](file:///Users/tunyuan/Library/CloudStorage/GoogleDrive-asc103138@st.tc.edu.tw/我的雲端硬碟/line待辦事項/SETUP_GUIDE.md)：詳細建置指引（LINE Developers、Gemini API Key、Google 試算表設定）。
- [`richmenu.json`](file:///Users/tunyuan/Library/CloudStorage/GoogleDrive-asc103138@st.tc.edu.tw/我的雲端硬碟/line待辦事項/richmenu.json)：LINE 圖文選單 6 格規格定義。

---

## 🚀 快速開始

請直接參閱 [SETUP_GUIDE.md](file:///Users/tunyuan/Library/CloudStorage/GoogleDrive-asc103138@st.tc.edu.tw/我的雲端硬碟/line待辦事項/SETUP_GUIDE.md) 開始部署！
