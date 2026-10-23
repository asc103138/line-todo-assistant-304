# 專案交接紀錄 - handoff.md

## 當前進度摘要
- **專案狀態**：已完成初始化與系統核心建置。
- **後端程式**：`Code.gs` 已全面升級為「節次維度三選一主動式建議助理」：
  - 06:30 晨間精確到【每一節課】提供 3 種教學安排方案（[A] 標準進度 / [B] 習作補救 / [C] 在地探究）供一鍵全選或節次微調，並確認臨時交辦。
  - 20:00 晚間主動梳理今日進度與突發，為【明日每一節課】規劃 3 種備選建議，一鍵排定明日早自修至第七節客製待辦。
  - 支援隨時回傳「臨時改變進度」即時重整當天各節安排。
  - 支援「重新設計進度」，AI 對照 11/05 期中考期程與南一數、翰林國、康軒社單元，端出三軌重整藍圖。
  - 嚴格鎖定梧棲中正國小 304 課表、服裝規定與 115 四上教科書版本（南一數、翰林國、康軒社、校本梧風啟航）。
- **前端儀表板**：`dashboard.html` 響應式 Tailwind CSS 網頁已測試完畢，可正常讀取試算表資料。
- **圖文選單**：已產出 2500x1686 6格圖文選單圖片 `richmenu.png` 與設定規格 `richmenu.json`。
- **資料庫分頁**：提供 `updateRealScheduleAndCalendar()` 函式，可一鍵將 34 節次真實課表與 33 項學校重大行事寫入 Google 試算表。

## 待接手/待操作項目
1. 老師在 Apps Script 執行 `updateRealScheduleAndCalendar()` 寫入課表與行事曆。
2. 老師在 LINE Official Account Manager 上傳 `richmenu.png` 套用圖文選單。
3. 老師在 Apps Script 觸發條件中確認新增 `sendMorningBriefing` (07:00) 與 `triggerEveningRDQ` (17:00)。

## 資安與敏感資訊檢查
- 本地專案未存放任何真實 LINE Token 或 Gemini API Key。
- 金鑰已妥善存放於 Google Apps Script 雲端「專案設定」->「指令碼屬性」中。
