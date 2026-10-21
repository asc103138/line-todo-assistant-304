# 專案交接紀錄 - handoff.md

## 當前進度摘要
- **專案狀態**：已完成初始化與系統核心建置。
- **後端程式**：`Code.gs` 已整合 LINE Webhook、Gemini 2.5 Flash 多模態辨識、RDQ 下班對話狀態機、晨間 07:00 / 傍晚 17:00 推播、班費自動計算，並嚴格鎖定梧棲中正國小 304 課表與 115 四上教科書版本（南一數、翰林國、康軒社）。
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
