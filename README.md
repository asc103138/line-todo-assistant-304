# 國小中年級導師 LINE 專屬智慧助教系統 (LINE Bot + GAS + Gemini 2.5 Flash)

專為臺灣國小中年級導師設計的日常教學、班級經營與行政減負助理。整合 LINE 官方帳號、Google Apps Script、Google 試算表與 Gemini 2.5/1.5 Flash 多模態 AI。

---

## 🌟 核心特色

1. **06:30 晨間主動安排與臨時交辦確認**：
   - 每日 06:30 主動推播，結合課表、行事曆與昨夜復盤結果，主動生成 3 套具體建議方案（方案 A 穩健進度 / 方案 B 重點補救 / 方案 C 行政活動優先）供導師一鍵確認或快速補充臨時交辦，不再只是丟空泛問題。
2. **20:00 晚間主動復盤與明日行程規劃**：
   - 每日 20:00 自動推播，結合當日課程實際進度、今日突發紀錄、臨時交辦與明日課表行事，主動提供 3 個復盤診斷選項（選項 1 進度達標 / 選項 2 概念補救 / 選項 3 親師追蹤）。
   - 導師點選或補充後，AI 即刻自動排定【明日早自修至第七節】客製化節次待辦與備課清單，形成主動式閉環助理！
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
