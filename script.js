// 圖書館管理系統核心功能
class LibrarySystem {
    constructor() {
        this.books = [];
        this.borrowedBooks = [];
        this.users = [];
        this.currentUser = null;
        this.adminUsername = 'sindy16872000';
        this.defaultGoogleWebAppUrl = 'https://script.google.com/macros/s/AKfycbxYZodHltoNvStyYHg3iHwflZ2W6g3vPNKftIOo3e8A22-jNL_-j_GmBbxzZwLt9Ot_/exec';
        this.autoSyncTimer = null;
        this.autoSyncLastRunAt = 0;
        this.autoSyncCooldownUntil = 0;
        this.autoSyncMinIntervalMs = 30000;
        this.autoSyncDebounceMs = 1500;
        this.pushNowInFlight = false;
        this.settings = {
            loanDays: 14,
            guestBorrow: false,
            defaultCopies: 1,
            defaultYear: 2024,
            autoUpdateInterval: 300000,
            googleWebAppUrl: ''
        };
        this.updateTimer = null;
        this.lastUpdateTime = null;
        
        this.init();
    }

    // 初始化系統
    init() {
        this.loadData();
        this.setupEventListeners();
        this.syncBorrowedPanelForViewport();
        // 自動從 Google Sheets 載入線上資料（若已設定同步網址）
        this.startAutoPull();
        this.renderBooks();
        this.renderBorrowedBooks();
        this.updateStats();
        this.updateUserDisplay();
        this.updateAdminControls();
        this.startAutoUpdate();
    }

    isAdminUser() {
        return !!(this.currentUser && this.currentUser.username === this.adminUsername);
    }

    requireAdmin(actionName) {
        if (this.isAdminUser()) return true;
        this.showToast(`${actionName}：僅限管理者帳號 ${this.adminUsername}`, 'error');
        return false;
    }

    updateAdminControls() {
        const isAdmin = this.isAdminUser();
        const ids = [
            'google-sync-btn',
            'settings-btn',
            'import-btn',
            'add-book-btn',
            'reload-csv-btn',
            'toggle-auto-update-btn',
            'reset-btn'
        ];

        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.style.display = isAdmin ? '' : 'none';
            el.disabled = !isAdmin;
            el.title = '';
            el.style.opacity = '';
            el.style.cursor = '';
        });

        const fileInput = document.getElementById('file-input');
        if (fileInput) {
            fileInput.style.display = isAdmin ? '' : 'none';
            fileInput.disabled = !isAdmin;
        }
    }

    async pushToGoogleSheetsNow() {
        const url = this.getGoogleWebAppUrl();
        if (!url) return;
        if (this.pushNowInFlight) return;

        this.pushNowInFlight = true;
        try {
            await this.pushToGoogleSheets({ silent: true });
        } catch (e) {
            console.error('pushToGoogleSheetsNow error:', e);
        } finally {
            this.pushNowInFlight = false;
        }
    }

    getGoogleWebAppUrl() {
        const url = (this.settings?.googleWebAppUrl || '').trim();
        return url || null;
    }

    startAutoPull() {
        const url = this.getGoogleWebAppUrl();
        if (!url) return;

        // 避免阻塞初始化，延後到下一輪事件迴圈
        setTimeout(() => {
            this.pullFromGoogleSheets({ silent: true, protectEmpty: true, closeModal: false });
        }, 0);
    }

    startAutoSync() {
        // 不用登入也能自動上傳，但必須先由管理者設定好 Web App URL
        // 這裡只做啟動，不做提示，避免干擾使用者
        this.scheduleAutoSync();
    }

    scheduleAutoSync() {
        if (this.autoSyncTimer) {
            clearTimeout(this.autoSyncTimer);
        }

        this.autoSyncTimer = setTimeout(() => {
            this.autoSyncTimer = null;
            this.autoPushToGoogleSheets();
        }, this.autoSyncDebounceMs);
    }

    async autoPushToGoogleSheets() {
        const url = this.getGoogleWebAppUrl();
        if (!url) return;

        const now = Date.now();
        if (now < this.autoSyncCooldownUntil) return;
        if (now - this.autoSyncLastRunAt < this.autoSyncMinIntervalMs) return;
        this.autoSyncLastRunAt = now;

        try {
            await this.pushToGoogleSheets({ silent: true });
        } catch (e) {
            // 失敗後退避，避免一直打
            this.autoSyncCooldownUntil = Date.now() + 60000;
            console.error('autoPushToGoogleSheets error:', e);
        }
    }

    // 設定事件監聽器
    setupEventListeners() {
        // 搜尋和篩選
        document.getElementById('search-input').addEventListener('input', () => this.renderBooks());
        document.getElementById('genre-filter').addEventListener('change', () => this.renderBooks());
        document.getElementById('sort-by').addEventListener('change', () => this.renderBooks());
        document.getElementById('sort-order').addEventListener('change', () => this.renderBooks());
        document.getElementById('search-btn').addEventListener('click', () => this.renderBooks());

        // 管理功能
        document.getElementById('boyou-books-btn').addEventListener('click', () => this.goToBoyouBooks());
        document.getElementById('import-btn').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) settingsBtn.addEventListener('click', () => this.showSettingsModal());
        document.getElementById('google-sync-btn').addEventListener('click', () => this.showGoogleSyncModal());
        document.getElementById('file-input').addEventListener('change', (e) => this.importBooks(e));
        document.getElementById('add-book-btn').addEventListener('click', () => this.showAddBookModal());
        document.getElementById('reload-csv-btn').addEventListener('click', () => this.reloadCSV());
        document.getElementById('toggle-auto-update-btn').addEventListener('click', () => this.toggleAutoUpdate());
        document.getElementById('reset-btn').addEventListener('click', () => this.resetData());
        document.getElementById('location-map-btn').addEventListener('click', () => this.showLocationMap());

        // 登入/登出
        document.getElementById('login-btn').addEventListener('click', () => this.showLoginModal());
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());

        // 模態框
        this.setupModalListeners();

        // 表單提交
        document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('add-book-form').addEventListener('submit', (e) => this.handleAddBook(e));
        const settingsForm = document.getElementById('settings-form');
        if (settingsForm) settingsForm.addEventListener('submit', (e) => this.handleSaveSettings(e));
        const editBookForm = document.getElementById('edit-book-form');
        if (editBookForm) {
            editBookForm.addEventListener('submit', (e) => this.handleEditBook(e));
        }

        const autoFillAddBtn = document.getElementById('auto-fill-add-book-btn');
        if (autoFillAddBtn) {
            autoFillAddBtn.addEventListener('click', () => this.autoFillBookInfo({
                titleInputId: 'book-title',
                authorInputId: 'book-author',
                yearInputId: 'book-year'
            }));
        }

        const autoFillEditBtn = document.getElementById('auto-fill-edit-book-btn');
        if (autoFillEditBtn) {
            autoFillEditBtn.addEventListener('click', () => this.autoFillBookInfo({
                titleInputId: 'edit-book-title',
                authorInputId: 'edit-book-author',
                yearInputId: 'edit-book-year'
            }));
        }

        // 視圖切換
        document.getElementById('grid-view').addEventListener('click', () => this.setView('grid'));
        document.getElementById('list-view').addEventListener('click', () => this.setView('list'));

        // 匯出借閱清單
        const exportBorrowedBtn = document.getElementById('export-borrowed-btn');
        if (exportBorrowedBtn) {
            exportBorrowedBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.exportBorrowedToExcel();
            });
        }

        const borrowedHeader = document.querySelector('.borrowed-header');
        if (borrowedHeader) {
            borrowedHeader.addEventListener('click', () => this.toggleBorrowedPanel());
            borrowedHeader.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.toggleBorrowedPanel();
                }
            });
        }

        const borrowedToggleBtn = document.getElementById('borrowed-toggle-btn');
        if (borrowedToggleBtn) {
            borrowedToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleBorrowedPanel();
            });
        }

        const borrowedFab = document.getElementById('borrowed-fab');
        if (borrowedFab) {
            borrowedFab.addEventListener('click', () => this.toggleBorrowedPanel());
        }

        // Google Sheets 同步
        const googlePullBtn = document.getElementById('google-pull-btn');
        const googlePushBtn = document.getElementById('google-push-btn');
        if (googlePullBtn) googlePullBtn.addEventListener('click', () => this.pullFromGoogleSheets());
        if (googlePushBtn) googlePushBtn.addEventListener('click', () => this.pushToGoogleSheets());

        window.addEventListener('resize', () => this.syncBorrowedPanelForViewport());
    }

    syncBorrowedPanelForViewport() {
        const panel = document.querySelector('.borrowed-section');
        if (!panel) return;

        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            if (!panel.classList.contains('open') && !panel.classList.contains('minimized')) {
                panel.classList.add('minimized');
            }
        } else {
            if (!panel.classList.contains('open') && !panel.classList.contains('minimized')) {
                panel.classList.add('open');
            }
        }

        this.updateBorrowedToggleIcon();
    }

    toggleBorrowedPanel() {
        const panel = document.querySelector('.borrowed-section');
        if (!panel) return;

        const willOpen = !panel.classList.contains('open');
        if (willOpen) {
            panel.classList.add('open');
            panel.classList.remove('minimized');
        } else {
            panel.classList.remove('open');
            panel.classList.add('minimized');
        }

        this.updateBorrowedToggleIcon();
    }

    updateBorrowedToggleIcon() {
        const icon = document.querySelector('#borrowed-toggle-btn i');
        if (!icon) return;

        const panel = document.querySelector('.borrowed-section');
        if (!panel) return;

        const isOpen = panel.classList.contains('open');
        icon.className = isOpen ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
    }

    // 設定模態框事件
    setupModalListeners() {
        const modals = document.querySelectorAll('.modal');
        const closes = document.querySelectorAll('.close');

        closes.forEach(close => {
            close.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                modal.style.display = 'none';
            });
        });

        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });
    }

    // 顯示位置圖
    showLocationMap() {
        const modal = document.getElementById('location-map-modal');
        if (modal) {
            modal.style.display = 'block';
        }
    }

    // 載入資料
    loadData() {
        this.books = JSON.parse(localStorage.getItem('lib_books_v1') || '[]');
        this.borrowedBooks = JSON.parse(localStorage.getItem('lib_borrowed_v1') || '[]');
        this.users = JSON.parse(localStorage.getItem('lib_users_v1') || '[]');
        this.currentUser = JSON.parse(localStorage.getItem('lib_active_user_v1') || 'null');

        const storedSettings = JSON.parse(localStorage.getItem('lib_settings_v1') || 'null');
        if (storedSettings && typeof storedSettings === 'object') {
            this.settings = { ...this.settings, ...storedSettings };
        }

        if (!this.settings.googleWebAppUrl) {
            this.settings.googleWebAppUrl = this.defaultGoogleWebAppUrl;
            localStorage.setItem('lib_settings_v1', JSON.stringify(this.settings));
        }
    }

    showGoogleSyncModal() {
        if (!this.requireAdmin('Google Sheets 同步')) return;
        const modal = document.getElementById('google-sync-modal');
        const urlInput = document.getElementById('google-webapp-url');
        if (urlInput) {
            urlInput.value = this.settings.googleWebAppUrl || '';
        }
        if (modal) {
            modal.style.display = 'block';
        }
    }

    showSettingsModal() {
        if (!this.requireAdmin('系統設定')) return;

        const modal = document.getElementById('settings-modal');
        const loanDays = document.getElementById('loan-days');
        const guestBorrow = document.getElementById('guest-borrow');
        const defaultCopies = document.getElementById('default-copies');
        const defaultYear = document.getElementById('default-year');

        if (loanDays) loanDays.value = String(this.settings.loanDays ?? 14);
        if (guestBorrow) guestBorrow.checked = !!this.settings.guestBorrow;
        if (defaultCopies) defaultCopies.value = String(this.settings.defaultCopies ?? 1);
        if (defaultYear) defaultYear.value = String(this.settings.defaultYear ?? 2024);

        if (modal) modal.style.display = 'block';
    }

    handleSaveSettings(e) {
        e.preventDefault();
        if (!this.requireAdmin('儲存設定')) return;

        let loanDays = parseInt(document.getElementById('loan-days')?.value, 10);
        if (!Number.isFinite(loanDays) || loanDays < 1) loanDays = 14;
        const guestBorrow = !!document.getElementById('guest-borrow')?.checked;
        const defaultCopies = parseInt(document.getElementById('default-copies')?.value) || 1;
        const defaultYear = parseInt(document.getElementById('default-year')?.value) || 2024;

        this.settings.loanDays = loanDays;
        this.settings.guestBorrow = guestBorrow;
        this.settings.defaultCopies = defaultCopies;
        this.settings.defaultYear = defaultYear;

        this.saveData();
        this.renderBooks();

        const modal = document.getElementById('settings-modal');
        if (modal) modal.style.display = 'none';
        this.showToast('設定已儲存', 'success');
    }

    getGoogleWebAppUrlFromUI() {
        const urlInput = document.getElementById('google-webapp-url');
        const url = urlInput ? urlInput.value.trim() : '';
        if (!url) {
            this.showToast('請先填入 Apps Script Web App URL', 'error');
            return null;
        }
        this.settings.googleWebAppUrl = url;
        this.saveData();
        return url;
    }

    async pushToGoogleSheets(options = {}) {
        const { silent = false } = options;
        const url = this.getGoogleWebAppUrl();
        if (!url) {
            if (!silent) this.showToast('請先由管理者設定 Google Sheets 同步網址', 'error');
            return;
        }

        try {
            if (!silent) this.showToast('正在上傳到 Google Sheets...', 'info');
            const boyouBooks = JSON.parse(localStorage.getItem('lib_boyou_books_v1') || 'null') || {};
            const response = await fetch(url, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'push',
                    payload: {
                        books: this.books,
                        borrowedBooks: this.borrowedBooks,
                        boyouBooks
                    }
                })
            });

            const result = await response.json().catch(() => null);
            if (!response.ok) {
                if (!silent) this.showToast('上傳失敗，請檢查 Web App 權限/網址', 'error');
                return;
            }

            if (result && result.ok) {
                if (!silent) this.showToast('上傳完成', 'success');
            } else {
                if (!silent) this.showToast('上傳完成，但回應格式不符', 'warning');
            }
        } catch (error) {
            console.error('pushToGoogleSheets error:', error);
            if (!silent) this.showToast('上傳失敗，請檢查網路或 CORS 設定', 'error');
            throw error;
        }
    }

    async pullFromGoogleSheets(options = {}) {
        const { silent = false, protectEmpty = false, closeModal = true } = options;
        const url = silent ? this.getGoogleWebAppUrl() : this.getGoogleWebAppUrlFromUI();
        if (!url) return;

        try {
            if (!silent) this.showToast('正在從 Google Sheets 下載...', 'info');
            const response = await fetch(url, {
                method: 'POST',
                body: JSON.stringify({ action: 'pull' })
            });

            const result = await response.json().catch(() => null);
            if (!response.ok || !result || !result.ok) {
                if (!silent) this.showToast('下載失敗，請檢查 Web App 權限/網址', 'error');
                return;
            }

            const data = result.data || {};
            if (!Array.isArray(data.books) || !Array.isArray(data.borrowedBooks)) {
                if (!silent) this.showToast('下載失敗：資料格式不正確', 'error');
                return;
            }

            if (protectEmpty && data.books.length === 0 && Array.isArray(this.books) && this.books.length > 0) {
                // 自動載入模式：線上空資料時不覆蓋本機，避免把館藏清空
                return;
            }

            if (data.books.length === 0 && Array.isArray(this.books) && this.books.length > 0) {
                const ok = confirm('線上 Books 資料是空的，下載會清空目前館藏。確定要覆蓋嗎？');
                if (!ok) {
                    if (!silent) this.showToast('已取消下載覆蓋', 'info');
                    return;
                }
            }

            this.books = data.books;
            this.borrowedBooks = data.borrowedBooks;

            if (data.boyouBooks && typeof data.boyouBooks === 'object') {
                localStorage.setItem('lib_boyou_books_v1', JSON.stringify(data.boyouBooks));
            }
            this.saveData();
            this.renderBooks();
            this.renderBorrowedBooks();
            this.updateStats();
            if (!silent) this.showToast('下載完成並已同步到本機', 'success');

            if (closeModal) {
                const modal = document.getElementById('google-sync-modal');
                if (modal) modal.style.display = 'none';
            }
        } catch (error) {
            console.error('pullFromGoogleSheets error:', error);
            if (!silent) this.showToast('下載失敗，請檢查網路或 CORS 設定', 'error');
        }
    }

    // 自動載入 CSV 檔案
    async autoLoadCSV() {
        console.log('開始載入本地 CSV 檔案');
        try {
            // 顯示載入中狀態
            this.showLoadingIndicator(true);
            
            // 載入本地 CSV 檔案
            const response = await fetch('113博幼館藏.csv');
            if (!response.ok) {
                console.log('本地 CSV 檔案載入失敗');
                this.showLoadingIndicator(false);
                return;
            }

            const csvText = await response.text();
            const csvData = this.parseCSV(csvText);
            
            if (csvData.length > 0) {
                this.processCSVData(csvData);
                this.lastUpdateTime = new Date();
                this.updateLastUpdateDisplay();
                this.showToast(`已載入本地 CSV 資料 (${csvData.length} 筆)`, 'success');
            }
            
            this.showLoadingIndicator(false);
        } catch (error) {
            console.log('載入失敗:', error);
            this.showLoadingIndicator(false);
        }
    }




    // 解析 CSV 文字
    parseCSV(csvText) {
        console.log('開始解析 CSV 文字，長度:', csvText.length);
        const lines = csvText.split('\n');
        console.log('CSV 行數:', lines.length);
        const data = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            // 跳過標題行和空行
            if (i < 4) {
                console.log(`跳過第${i}行 (標題行):`, line);
                continue;
            }
            
            const columns = line.split(',');
            if (columns.length >= 2 && columns[0]) {
                console.log(`處理第${i}行:`, columns[0], columns[1]);
                data.push(columns);
            } else {
                console.log(`跳過第${i}行 (格式不符):`, line);
            }
        }
        
        console.log('CSV 解析完成，共', data.length, '筆有效資料');
        return data;
    }

    // 處理 CSV 資料
    processCSVData(csvData) {
        console.log('開始處理 CSV 資料，共', csvData.length, '筆');
        console.log('處理前書籍數量:', this.books.length);
        
        // 清空現有書籍資料，避免累積
        this.books = [];
        
        let successCount = 0;
        let errorCount = 0;
        const errors = [];
        const bookMap = new Map(); // 用於合併相同書名的書籍

        for (let i = 0; i < csvData.length; i++) {
            const row = csvData[i];
            if (!row || row.length === 0 || !row[0]) continue;

            const id = row[0].toString().trim();
            let title = row[1] ? row[1].toString().trim() : '';

            // 驗證書碼格式
            if (!/^[ABC]\d+$/.test(id)) {
                errors.push(`第${i+5}行：書碼格式錯誤 (${id})`);
                errorCount++;
                continue;
            }

            // 如果書名為空，跳過此記錄
            if (!title) {
                console.log(`跳過第${i+5}行：書名為空 (${id})`);
                continue;
            }

            // 檢查重複書碼（在當前處理的資料中）
            if (bookMap.has(title) && bookMap.get(title).bookIds.includes(id)) {
                errors.push(`第${i+5}行：書碼重複 (${id})`);
                errorCount++;
                continue;
            }

            const genre = this.getGenreFromId(id);
            const year = this.settings.defaultYear;
            const copies = 1; // 預設冊數為 1

            // 檢查是否已存在相同書名的書籍
            if (bookMap.has(title)) {
                const existingBook = bookMap.get(title);
                existingBook.copies += copies;
                existingBook.availableCopies += copies;
                existingBook.bookIds.push(id); // 記錄所有書碼
            } else {
                const newBook = {
                    id, // 主要書碼
                    bookIds: [id], // 所有書碼列表
                    title,
                    genre,
                    year,
                    copies,
                    availableCopies: copies
                };
                bookMap.set(title, newBook);
            }
            successCount++;
        }

        // 將合併後的書籍添加到陣列中
        for (const book of bookMap.values()) {
            this.books.push(book);
        }

        console.log('處理完成，共載入', this.books.length, '本書籍');
        console.log('書籍列表:', this.books);

        this.saveData();

        if (successCount > 0) {
            console.log(`成功載入 ${successCount} 本書籍`);
        }
        if (errorCount > 0) {
            console.log(`有 ${errorCount} 筆資料載入失敗`);
            console.log('載入錯誤:', errors);
        }
    }

    // 儲存資料
    saveData() {
        localStorage.setItem('lib_books_v1', JSON.stringify(this.books));
        localStorage.setItem('lib_borrowed_v1', JSON.stringify(this.borrowedBooks));
        localStorage.setItem('lib_users_v1', JSON.stringify(this.users));
        localStorage.setItem('lib_active_user_v1', JSON.stringify(this.currentUser));
        localStorage.setItem('lib_settings_v1', JSON.stringify(this.settings));
    }

    // 顯示登入模態框
    showLoginModal() {
        document.getElementById('login-modal').style.display = 'block';
    }

    // 處理登入
    handleLogin(e) {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const role = document.getElementById('user-role').value;

        if (!username.trim()) {
            this.showToast('請輸入使用者名稱', 'error');
            return;
        }

        this.currentUser = { username, role };
        this.saveData();
        this.updateUserDisplay();
        this.updateAdminControls();
        if (!this.isAdminUser()) {
            this.stopAutoUpdate();
        } else {
            this.startAutoUpdate();
        }
        this.renderBooks();
        this.renderBorrowedBooks();
        
        document.getElementById('login-modal').style.display = 'none';
        document.getElementById('login-form').reset();
        this.showToast(`歡迎 ${username}！`, 'success');
    }

    // 登出
    logout() {
        this.currentUser = null;
        this.saveData();
        this.updateUserDisplay();
        this.updateAdminControls();
        this.stopAutoUpdate();
        this.renderBooks();
        this.renderBorrowedBooks();
        this.showToast('已登出', 'success');
    }

    // 更新使用者顯示
    updateUserDisplay() {
        const currentUserSpan = document.getElementById('current-user');
        const loginBtn = document.getElementById('login-btn');
        const logoutBtn = document.getElementById('logout-btn');

        if (this.currentUser) {
            currentUserSpan.textContent = `${this.currentUser.username} (${this.getRoleName(this.currentUser.role)})`;
            loginBtn.style.display = 'none';
            logoutBtn.style.display = 'inline-flex';
        } else {
            currentUserSpan.textContent = '訪客';
            loginBtn.style.display = 'inline-flex';
            logoutBtn.style.display = 'none';
        }
    }

    // 取得角色名稱
    getRoleName(role) {
        const roleNames = {
            'guest': '訪客',
            'student': '學生',
            'staff': '老師/館員'
        };
        return roleNames[role] || '未知';
    }

    // 顯示新增書籍模態框
    showAddBookModal() {
        if (!this.requireAdmin('新增館藏')) return;
        document.getElementById('add-book-modal').style.display = 'block';
        
        // 設定預設值
        document.getElementById('book-year').value = this.settings.defaultYear;
        document.getElementById('book-copies').value = this.settings.defaultCopies;
        
        // 清空表單
        document.getElementById('add-book-form').reset();
        
        // 重新設定預設值（因為reset會清空）
        document.getElementById('book-year').value = this.settings.defaultYear;
        document.getElementById('book-copies').value = this.settings.defaultCopies;
        const authorInput = document.getElementById('book-author');
        if (authorInput) authorInput.value = '';

        // 預填下一個書碼（仍可手動修改）
        const suggestedId = this.suggestNextBookId();
        const bookIdInput = document.getElementById('book-id');
        const bookPrefixSelect = document.getElementById('book-prefix');

        if (bookPrefixSelect) {
            const m = String(suggestedId || '').toUpperCase().match(/^([ABC])/);
            bookPrefixSelect.value = m ? m[1] : 'C';
        }
        if (bookIdInput && suggestedId) {
            bookIdInput.value = suggestedId;
        }

        if (suggestedId) {
            this.showToast(`已預填書碼 ${suggestedId}，可從此號開始編輯（可自行修改）`, 'info');
        }
        
        // 聚焦到書碼輸入框
        setTimeout(() => {
            document.getElementById('book-id').focus();
            if (document.getElementById('book-id')?.value) {
                document.getElementById('book-id').select();
            }
        }, 100);
        
        // 添加實時驗證
        this.setupAddBookValidation();
    }

    suggestNextBookId() {
        const genreFilter = document.getElementById('genre-filter')?.value;
        const prefixMap = { '繪本': 'A', '橋梁書': 'B', '文字書': 'C' };
        const prefix = prefixMap[genreFilter] || 'C';
        return this.generateNextBookId(prefix);
    }

    generateNextBookId(prefix) {
        const used = new Set();

        this.books.forEach(book => {
            if (book?.id) used.add(String(book.id).toUpperCase());
            if (Array.isArray(book?.bookIds)) {
                book.bookIds.forEach(id => {
                    if (id) used.add(String(id).toUpperCase());
                });
            }
        });

        let next = 1;
        while (true) {
            const candidate = `${prefix}${String(next).padStart(4, '0')}`;
            if (!used.has(candidate)) return candidate;
            next++;
        }
    }

    hasBookId(id) {
        const target = String(id || '').trim().toUpperCase();
        if (!target) return false;

        return this.books.some(book => {
            if (!book) return false;
            if (String(book.id || '').toUpperCase() === target) return true;
            if (Array.isArray(book.bookIds) && book.bookIds.some(x => String(x || '').toUpperCase() === target)) return true;
            return false;
        });
    }

    // 處理新增書籍
    handleAddBook(e) {
        e.preventDefault();

        try {
            const idEl = document.getElementById('book-id');
            const titleEl = document.getElementById('book-title');
            const authorEl = document.getElementById('book-author');
            const yearEl = document.getElementById('book-year');
            const copiesEl = document.getElementById('book-copies');

            if (!idEl || !titleEl || !yearEl || !copiesEl) {
                this.showToast('新增失敗：表單欄位不存在，請重新整理頁面', 'error');
                return;
            }

            const id = idEl.value.trim().toUpperCase();
            const title = titleEl.value.trim();
            const author = (authorEl?.value || '').trim();
            const year = parseInt(yearEl.value) || this.settings.defaultYear;
            const copies = parseInt(copiesEl.value) || this.settings.defaultCopies;

            // 驗證書碼格式（支援全形和半形字符）
            if (!/^[ABC]\d+$/.test(id)) {
                this.showToast('書碼格式錯誤：請用 A/B/C + 數字（例：C0001）', 'error');
                return;
            }

            // 檢查重複書碼
            if (this.hasBookId(id)) {
                this.showToast('書碼已存在', 'error');
                return;
            }

            if (!title) {
                this.showToast('請輸入書名', 'error');
                return;
            }

            const genre = this.getGenreFromId(id);
            const newBook = {
                id,
                title,
                author,
                genre,
                year,
                copies,
                availableCopies: copies
            };

            this.books.push(newBook);
            this.saveData();
            // 新增館藏後也自動同步到 Google Sheets
            this.scheduleAutoSync();
            this.pushToGoogleSheetsNow();
            this.renderBooks();
            this.updateStats();

            const modal = document.getElementById('add-book-modal');
            if (modal) modal.style.display = 'none';
            const form = document.getElementById('add-book-form');
            if (form) form.reset();

            this.showToast('書籍新增成功！', 'success');
        } catch (err) {
            console.error('handleAddBook error:', err);
            this.showToast(`新增失敗：${err?.message || err}`, 'error');
        }
    }

    // 設定新增書籍表單的實時驗證
    setupAddBookValidation() {
        const bookIdInput = document.getElementById('book-id');
        const bookTitleInput = document.getElementById('book-title');
        const bookPrefixSelect = document.getElementById('book-prefix');

        if (!bookIdInput || !bookTitleInput) return;

        if (bookPrefixSelect && !bookPrefixSelect.dataset.bound) {
            bookPrefixSelect.dataset.bound = '1';
            bookPrefixSelect.addEventListener('change', (e) => {
                const prefix = String(e.target.value || '').toUpperCase();
                if (!/^[ABC]$/.test(prefix)) return;
                const generated = this.generateNextBookId(prefix);
                if (bookIdInput) bookIdInput.value = generated;
                if (bookIdInput) bookIdInput.dispatchEvent(new Event('input'));
            });
        }
        
        // 書碼格式驗證
        if (!bookIdInput.dataset.bound) {
            bookIdInput.dataset.bound = '1';
            bookIdInput.addEventListener('input', (e) => {
            const value = e.target.value.trim();
            const upper = value.toUpperCase();

            if (/^[ABC]$/.test(upper)) {
                const generated = this.generateNextBookId(upper);
                e.target.value = generated;
            }

            if (bookPrefixSelect) {
                const m = String(e.target.value || '').toUpperCase().match(/^([ABC])/);
                if (m) bookPrefixSelect.value = m[1];
            }

            const currentValue = e.target.value.trim().toUpperCase();
            const isValid = /^[ABC]\d+$/.test(currentValue);
            
            if (currentValue && !isValid) {
                e.target.style.borderColor = '#f56565';
                this.showFieldError('book-id', '書碼格式：A/B/C + 數字');
            } else {
                e.target.style.borderColor = '#e2e8f0';
                this.hideFieldError('book-id');
            }

            if (/^[ABC]\d+$/.test(currentValue) && this.hasBookId(currentValue)) {
                e.target.style.borderColor = '#f56565';
                this.showFieldError('book-id', '書碼已存在');
            }
            });
        }
        
        // 書名驗證
        if (!bookTitleInput.dataset.bound) {
            bookTitleInput.dataset.bound = '1';
            bookTitleInput.addEventListener('input', (e) => {
            const value = e.target.value.trim();
            
            if (value.length === 0) {
                e.target.style.borderColor = '#f56565';
                this.showFieldError('book-title', '請輸入書名');
            } else {
                e.target.style.borderColor = '#e2e8f0';
                this.hideFieldError('book-title');
            }
            });
        }
    }

    // 顯示欄位錯誤提示
    showFieldError(fieldId, message) {
        const field = document.getElementById(fieldId);
        let errorDiv = field.parentNode.querySelector('.field-error');
        
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'field-error';
            field.parentNode.appendChild(errorDiv);
        }
        
        errorDiv.textContent = message;
        errorDiv.style.color = '#f56565';
        errorDiv.style.fontSize = '0.8rem';
        errorDiv.style.marginTop = '5px';
    }

    // 隱藏欄位錯誤提示
    hideFieldError(fieldId) {
        const field = document.getElementById(fieldId);
        const errorDiv = field.parentNode.querySelector('.field-error');
        
        if (errorDiv) {
            errorDiv.remove();
        }
    }

    // 從書碼取得類別
    getGenreFromId(id) {
        const firstChar = id.charAt(0).toUpperCase();
        const genreMap = {
            'A': '繪本',
            'B': '橋梁書',
            'C': '文字書'
        };
        return genreMap[firstChar] || '未知';
    }

    // 智能書名排序：讓相似書名聚集在一起
    smartTitleSort(titleA, titleB, sortOrder) {
        // 提取書名的主要部分（去除數字、括號等）
        const cleanTitleA = this.cleanTitle(titleA);
        const cleanTitleB = this.cleanTitle(titleB);
        
        // 先按清理後的書名排序
        const cleanCompare = cleanTitleA.localeCompare(cleanTitleB, 'zh-TW');
        
        if (cleanCompare !== 0) {
            return sortOrder === 'asc' ? cleanCompare : -cleanCompare;
        }
        
        // 如果清理後的書名相同，則按完整書名排序
        const fullCompare = titleA.localeCompare(titleB, 'zh-TW');
        return sortOrder === 'asc' ? fullCompare : -fullCompare;
    }

    // 清理書名：移除數字、括號等，保留主要書名
    cleanTitle(title) {
        // 移除常見的後綴模式
        return title
            .replace(/[（(].*?[）)]/g, '') // 移除括號內容
            .replace(/\d+.*$/g, '') // 移除末尾的數字
            .replace(/[第].*?[卷冊部集]/g, '') // 移除第X卷/冊/部/集
            .replace(/[上下中].*$/g, '') // 移除上/下/中
            .replace(/[全].*$/g, '') // 移除全
            .replace(/[一二三四五六七八九十百千萬]+/g, '') // 移除中文數字
            .replace(/[IVXLC]+/g, '') // 移除羅馬數字
            .trim();
    }

    // 排序書籍，讓同系列書籍排在一起
    sortBooksWithSeries(books) {
        // 為每本書添加清理後的書名和系列標記
        const booksWithSeriesInfo = books.map(book => ({
            ...book,
            cleanTitle: this.cleanTitle(book.title),
            hasSeriesMarkers: /[（(].*?[）)]|\d+.*$|[第].*?[卷冊部集]|[上下中].*$|[全].*$/.test(book.title)
        }));
        
        // 按系列分組
        const seriesMap = new Map();
        const standaloneBooks = [];
        
        booksWithSeriesInfo.forEach(book => {
            if (book.hasSeriesMarkers && book.cleanTitle.length > 0) {
                if (!seriesMap.has(book.cleanTitle)) {
                    seriesMap.set(book.cleanTitle, []);
                }
                seriesMap.get(book.cleanTitle).push(book);
            } else {
                standaloneBooks.push(book);
            }
        });
        
        const sortedBooks = [];
        
        // 處理系列書籍（至少2本才算系列）
        seriesMap.forEach((seriesBooks, seriesName) => {
            if (seriesBooks.length >= 2) {
                // 按書名排序系列內的書籍
                seriesBooks.sort((a, b) => a.title.localeCompare(b.title, 'zh-TW'));
                sortedBooks.push(...seriesBooks);
            } else {
                // 單本書籍加入獨立書籍
                standaloneBooks.push(...seriesBooks);
            }
        });
        
        // 添加獨立書籍
        sortedBooks.push(...standaloneBooks);
        
        return sortedBooks;
    }

    // 匯入書籍
    importBooks(event) {
        if (!this.requireAdmin('匯入 Excel 書單')) return;
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                this.processImportData(jsonData);
            } catch (error) {
                this.showToast('檔案格式錯誤', 'error');
                console.error('Import error:', error);
            }
        };
        reader.readAsArrayBuffer(file);
    }

    // 處理匯入資料
    processImportData(data) {
        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        // 跳過標題行，從第二行開始處理
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row || row.length === 0 || !row[0]) continue;

            const id = row[0].toString().trim();
            const title = row[1] ? row[1].toString().trim() : '';
            const copies = row[2] ? parseInt(row[2]) : this.settings.defaultCopies;

            // 驗證書碼格式
            if (!/^[ABC]\d+$/.test(id)) {
                errors.push(`第${i+1}行：書碼格式錯誤 (${id})`);
                errorCount++;
                continue;
            }

            // 檢查重複書碼
            if (this.books.find(book => book.id === id)) {
                errors.push(`第${i+1}行：書碼重複 (${id})`);
                errorCount++;
                continue;
            }

            if (!title) {
                errors.push(`第${i+1}行：缺少書名`);
                errorCount++;
                continue;
            }

            const genre = this.getGenreFromId(id);
            const year = this.settings.defaultYear;

            const newBook = {
                id,
                title,
                genre,
                year,
                copies: copies || this.settings.defaultCopies,
                availableCopies: copies || this.settings.defaultCopies
            };

            this.books.push(newBook);
            successCount++;
        }

        this.saveData();
        this.renderBooks();
        this.updateStats();

        if (successCount > 0) {
            this.showToast(`成功匯入 ${successCount} 本書籍`, 'success');
        }
        if (errorCount > 0) {
            this.showToast(`有 ${errorCount} 筆資料匯入失敗`, 'warning');
            console.log('Import errors:', errors);
        }
    }

    // 借閱書籍
    borrowBook(bookId) {
        console.log('借閱按鈕被點擊，書碼:', bookId);
        console.log('當前使用者:', this.currentUser);
        
        if (!this.currentUser) {
            this.showToast('請先登入', 'error');
            return;
        }

        if (this.currentUser.role === 'guest' && !this.settings.guestBorrow) {
            this.showToast('訪客無法借閱書籍', 'error');
            return;
        }

        const book = this.books.find(b => b.id === bookId);
        if (!book) {
            this.showToast('書籍不存在', 'error');
            return;
        }

        if (book.availableCopies <= 0) {
            this.showToast('此書籍已全部借出', 'error');
            return;
        }

        // 允許同一使用者借多本（若館藏有多本），但最多不超過該書總冊數
        const userBorrowedCount = this.borrowedBooks.filter(
            b => b.bookId === bookId && b.userId === this.currentUser.username && !b.returnedAt
        ).length;
        if (userBorrowedCount >= (book.copies || 1)) {
            this.showToast('您已借滿此書所有冊數', 'error');
            return;
        }

        const borrowDate = new Date();
        const dueDate = new Date(borrowDate.getTime() + this.settings.loanDays * 24 * 60 * 60 * 1000);

        const borrowRecord = {
            id: Date.now().toString(),
            bookId,
            bookTitle: book.title,
            userId: this.currentUser.username,
            borrowDate: borrowDate.toISOString(),
            dueDate: dueDate.toISOString(),
            returnedAt: null
        };

        this.borrowedBooks.push(borrowRecord);
        book.availableCopies--;

        this.saveData();
        // 所有使用者：只要借閱成功就自動上傳到 Google Sheets
        this.scheduleAutoSync();
        this.pushToGoogleSheetsNow();
        this.renderBooks();
        this.renderBorrowedBooks();
        this.updateStats();
        this.showToast('借閱成功！', 'success');
    }

    // 歸還書籍
    returnBook(borrowId) {
        const borrowRecord = this.borrowedBooks.find(b => b.id === borrowId);
        if (!borrowRecord) {
            this.showToast('借閱記錄不存在', 'error');
            return;
        }

        if (borrowRecord.returnedAt) {
            this.showToast('此書籍已歸還', 'error');
            return;
        }

        borrowRecord.returnedAt = new Date().toISOString();
        
        const book = this.books.find(b => b.id === borrowRecord.bookId);
        if (book) {
            book.availableCopies++;
        }

        this.saveData();
        // 所有使用者：只要歸還成功也自動上傳到 Google Sheets
        this.scheduleAutoSync();
        this.pushToGoogleSheetsNow();
        this.renderBooks();
        this.renderBorrowedBooks();
        this.updateStats();
        this.showToast('歸還成功！', 'success');
    }

    // 渲染書籍列表
    renderBooks() {
        console.log('開始渲染書籍，當前書籍數量:', this.books.length);
        const container = document.getElementById('books-container');
        const rawSearchTerm = document.getElementById('search-input').value;
        const normalizedSearchTerm = (rawSearchTerm || '').trim();
        const searchTerm = normalizedSearchTerm.toLowerCase();
        const genreFilter = document.getElementById('genre-filter').value;
        const sortBy = document.getElementById('sort-by').value;
        const sortOrder = document.getElementById('sort-order').value;

        // 書碼精準搜尋：支援多個書碼（逗號/空白分隔）
        const codeTokens = (normalizedSearchTerm || '')
            .toUpperCase()
            .split(/[\s,，]+/)
            .map(s => s.trim())
            .filter(Boolean);
        const isCodeSearch = codeTokens.length > 0 && codeTokens.every(t => /^[ABC]\d+$/.test(t));

        let filteredBooks = this.books.filter(book => {
            let matchesSearch;

            if (!searchTerm) {
                matchesSearch = true;
            } else if (isCodeSearch) {
                const mainId = String(book.id || '').toUpperCase();
                const allIds = Array.isArray(book.bookIds)
                    ? book.bookIds.map(id => String(id || '').toUpperCase())
                    : [];
                matchesSearch = codeTokens.some(code => code === mainId || allIds.includes(code));
            } else {
                matchesSearch =
                    String(book.title || '').toLowerCase().includes(searchTerm) ||
                    String(book.author || '').toLowerCase().includes(searchTerm) ||
                    String(book.id || '').toLowerCase().includes(searchTerm) ||
                    (book.bookIds && book.bookIds.some(id => String(id || '').toLowerCase().includes(searchTerm))) ||
                    String(book.year ?? '').toLowerCase().includes(searchTerm) ||
                    String(book.genre || '').toLowerCase().includes(searchTerm);
            }
            
            const matchesGenre = !genreFilter || book.genre === genreFilter;
            
            return matchesSearch && matchesGenre;
        });

        // 智能排序：讓相似書名的書籍聚集在一起
        filteredBooks.sort((a, b) => {
            // 首先按類別分組
            const genreOrder = ['繪本', '橋梁書', '文字書'];
            const aGenreIndex = genreOrder.indexOf(a.genre);
            const bGenreIndex = genreOrder.indexOf(b.genre);
            
            if (aGenreIndex !== bGenreIndex) {
                return aGenreIndex - bGenreIndex;
            }
            
            // 然後按主要排序條件排序
            let aVal = a[sortBy];
            let bVal = b[sortBy];
            
            if (sortBy === 'year') {
                aVal = parseInt(aVal);
                bVal = parseInt(bVal);
            } else if (sortBy === 'title') {
                // 對於書名排序，使用智能分組
                return this.smartTitleSort(a.title, b.title, sortOrder);
            } else {
                aVal = aVal.toString().toLowerCase();
                bVal = bVal.toString().toLowerCase();
            }
            
            if (sortOrder === 'asc') {
                return aVal > bVal ? 1 : -1;
            } else {
                return aVal < bVal ? 1 : -1;
            }
        });

        if (filteredBooks.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-book-open"></i>
                    <h3>沒有找到書籍</h3>
                    <p>請嘗試調整搜尋條件或新增書籍</p>
                </div>
            `;
            return;
        }

        const isGridView = document.getElementById('grid-view').classList.contains('active');
        container.className = isGridView ? 'books-grid' : 'books-list';
        
        // 分組同系列書籍，但只排序不分組
        const sortedBooks = this.sortBooksWithSeries(filteredBooks);
        
        container.innerHTML = sortedBooks.map(book => this.createBookCard(book)).join('');
    }

    // 建立書籍卡片
    createBookCard(book) {
        const canBorrow = this.currentUser && 
            (this.currentUser.role !== 'guest' || this.settings.guestBorrow) &&
            book.availableCopies > 0;

        const userBorrowedCount = this.borrowedBooks.filter(
            b => b.bookId === book.id && b.userId === this.currentUser?.username && !b.returnedAt
        ).length;

        // 顯示書碼資訊
        const bookIdsDisplay = book.bookIds && book.bookIds.length > 1 
            ? `${book.id} 等${book.bookIds.length}本` 
            : book.id;

        const canManageBooks = this.isAdminUser();

        return `
            <div class="book-card genre-${book.genre} ${book.availableCopies === 0 ? 'borrowed' : ''} ${book.bookIds && book.bookIds.length > 1 ? 'merged' : ''}">
                <div class="book-header">
                    <span class="book-id">${bookIdsDisplay}</span>
                    <span class="book-genre">${book.genre}</span>
                </div>
                <div class="book-title">${book.title}</div>
                ${book.author ? `<div class="book-info-item"><i class=\"fas fa-pen-nib\"></i><span>${book.author}</span></div>` : ''}
                <div class="book-info">
                    <div class="book-info-item">
                        <i class="fas fa-calendar"></i>
                        <span>${book.year}年</span>
                    </div>
                    <div class="book-info-item">
                        <i class="fas fa-copy"></i>
                        <span>可借 ${book.availableCopies}/${book.copies} 本</span>
                    </div>
                    ${book.bookIds && book.bookIds.length > 1 ? `
                    <div class="book-info-item">
                        <i class="fas fa-list"></i>
                        <span>書碼：${book.bookIds.join(', ')}</span>
                    </div>
                    ` : ''}
                </div>
                <div class="book-actions">
                    ${canBorrow ? 
                        `<button class="btn btn-primary btn-small" onclick="library.borrowBook('${book.id}')">
                            <i class="fas fa-book-reader"></i> ${userBorrowedCount > 0 ? '再借' : '借閱'}
                        </button>` : 
                        `<button class="btn btn-outline btn-small" disabled>
                            <i class="fas fa-ban"></i> 無法借閱
                        </button>`
                    }
                    ${canManageBooks ? `
                        <button class="btn btn-info btn-small" onclick="library.showEditBookModal('${book.id}')">
                            <i class="fas fa-pen"></i> 編輯
                        </button>
                        <button class="btn btn-warning btn-small" onclick="library.deleteBook('${book.id}')">
                            <i class="fas fa-trash"></i> 刪除
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    showEditBookModal(bookId) {
        if (!this.requireAdmin('編輯書籍')) return;

        const book = this.books.find(b => b.id === bookId);
        if (!book) {
            this.showToast('書籍不存在', 'error');
            return;
        }

        const modal = document.getElementById('edit-book-modal');
        const originalIdInput = document.getElementById('edit-book-original-id');
        const idInput = document.getElementById('edit-book-id');
        const titleInput = document.getElementById('edit-book-title');
        const authorInput = document.getElementById('edit-book-author');
        const yearInput = document.getElementById('edit-book-year');
        const copiesInput = document.getElementById('edit-book-copies');

        if (originalIdInput) originalIdInput.value = book.id;
        if (idInput) idInput.value = book.id;
        if (titleInput) titleInput.value = book.title || '';
        if (authorInput) authorInput.value = book.author || '';
        if (yearInput) yearInput.value = book.year || this.settings.defaultYear;
        if (copiesInput) copiesInput.value = book.copies || 1;

        if (modal) modal.style.display = 'block';
    }

    handleEditBook(e) {
        e.preventDefault();
        if (!this.requireAdmin('編輯書籍')) return;

        const originalId = (document.getElementById('edit-book-original-id')?.value || '').trim();
        const title = (document.getElementById('edit-book-title')?.value || '').trim();
        const author = (document.getElementById('edit-book-author')?.value || '').trim();
        const year = parseInt(document.getElementById('edit-book-year')?.value) || this.settings.defaultYear;
        const newCopies = parseInt(document.getElementById('edit-book-copies')?.value) || 1;

        if (!originalId) {
            this.showToast('編輯失敗：缺少書碼', 'error');
            return;
        }
        if (!title) {
            this.showToast('請輸入書名', 'error');
            return;
        }

        const book = this.books.find(b => b.id === originalId);
        if (!book) {
            this.showToast('書籍不存在', 'error');
            return;
        }

        const borrowedCount = this.borrowedBooks.filter(b => b.bookId === originalId && !b.returnedAt).length;
        if (newCopies < borrowedCount) {
            this.showToast(`冊數不得小於已借出數量 (${borrowedCount})`, 'error');
            return;
        }

        book.title = title;
        book.author = author;
        book.year = year;
        book.copies = newCopies;
        book.availableCopies = newCopies - borrowedCount;

        if (Array.isArray(book.bookIds) && !book.bookIds.includes(book.id)) {
            book.bookIds.unshift(book.id);
        }

        this.saveData();
        this.renderBooks();
        this.updateStats();

        const modal = document.getElementById('edit-book-modal');
        if (modal) modal.style.display = 'none';
        this.showToast('書籍已更新', 'success');
    }

    async autoFillBookInfo({ titleInputId, authorInputId, yearInputId }) {
        const titleInput = document.getElementById(titleInputId);
        const authorInput = document.getElementById(authorInputId);
        const yearInput = document.getElementById(yearInputId);

        const title = (titleInput?.value || '').trim();
        const author = (authorInput?.value || '').trim();

        if (!title && !author) {
            this.showToast('請先輸入書名或作者再搜尋', 'warning');
            return;
        }

        try {
            const q = [];
            if (title) q.push(`intitle:${title}`);
            if (author) q.push(`inauthor:${author}`);
            const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q.join('+'))}&maxResults=5`;

            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const item = data?.items?.[0];
            const info = item?.volumeInfo;
            if (!info) {
                this.showToast('找不到符合的書籍資料', 'warning');
                return;
            }

            const foundTitle = (info.title || '').trim();
            const foundAuthors = Array.isArray(info.authors) ? info.authors.join('、') : '';
            const published = (info.publishedDate || '').trim();
            const year = published ? parseInt(published.slice(0, 4), 10) : NaN;

            if (titleInput && foundTitle && !titleInput.value.trim()) titleInput.value = foundTitle;
            if (authorInput && foundAuthors) authorInput.value = foundAuthors;
            if (yearInput && Number.isFinite(year)) yearInput.value = String(year);

            this.showToast('已自動回填書籍資訊', 'success');
        } catch (err) {
            console.error('autoFillBookInfo error:', err);
            this.showToast('自動搜尋失敗，請檢查網路或稍後再試', 'error');
        }
    }

    deleteBook(bookId) {
        if (!this.requireAdmin('刪除書籍')) return;

        const book = this.books.find(b => b.id === bookId);
        if (!book) {
            this.showToast('書籍不存在', 'error');
            return;
        }

        const borrowedCount = this.borrowedBooks.filter(b => b.bookId === bookId && !b.returnedAt).length;
        if (borrowedCount > 0) {
            this.showToast('此書籍仍有未歸還借閱，無法刪除', 'error');
            return;
        }

        if (!confirm(`確定要刪除「${book.title}」嗎？`)) return;

        this.books = this.books.filter(b => b.id !== bookId);
        this.saveData();
        this.renderBooks();
        this.updateStats();
        this.showToast('書籍已刪除', 'success');
    }

    // 渲染借閱記錄
    renderBorrowedBooks() {
        const container = document.getElementById('borrowed-container');
        
        if (!this.currentUser) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-sign-in-alt"></i>
                    <h3>請先登入</h3>
                    <p>登入後即可查看借閱記錄</p>
                </div>
            `;
            return;
        }

        // 根據使用者角色決定顯示範圍
        let borrowedBooks;
        if (this.currentUser.role === 'staff') {
            // 老師/館員可以看到所有借閱記錄
            borrowedBooks = this.borrowedBooks.filter(b => !b.returnedAt);
        } else {
            // 學生和訪客只能看到自己的借閱記錄
            borrowedBooks = this.borrowedBooks.filter(
                b => b.userId === this.currentUser.username && !b.returnedAt
            );
        }

        if (borrowedBooks.length === 0) {
            const message = this.currentUser.role === 'staff' 
                ? '目前沒有借閱記錄' 
                : '您目前沒有借閱記錄';
            const subMessage = this.currentUser.role === 'staff'
                ? '所有書籍都已歸還'
                : '快去借閱您喜歡的書籍吧！';
                
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-book"></i>
                    <h3>${message}</h3>
                    <p>${subMessage}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = borrowedBooks.map(record => this.createBorrowedItem(record)).join('');
    }

    // 建立借閱項目
    createBorrowedItem(record) {
        const borrowDate = new Date(record.borrowDate);
        const dueDate = new Date(record.dueDate);
        const now = new Date();
        const daysLeft = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));

        return `
            <div class="borrowed-item">
                <div class="borrowed-info">
                    <div class="borrowed-title">${record.bookTitle}</div>
                    <div class="borrowed-details">
                        <div><i class="fas fa-user"></i> 借閱者：${record.userId}</div>
                        <div><i class="fas fa-calendar-plus"></i> 借閱日期：${borrowDate.toLocaleDateString()}</div>
                        <div><i class="fas fa-calendar-check"></i> 應還日期：${dueDate.toLocaleDateString()}</div>
                        <div>
                            <i class="fas fa-clock"></i> 剩餘 ${daysLeft} 天
                        </div>
                    </div>
                </div>
                <div class="borrowed-actions">
                    <button class="btn btn-success btn-small" onclick="library.returnBook('${record.id}')">
                        <i class="fas fa-undo"></i> 歸還
                    </button>
                </div>
            </div>
        `;
    }

    // 更新統計資訊
    updateStats() {
        const totalBooks = this.books.reduce((sum, book) => sum + book.copies, 0);
        const uniqueTitles = this.books.length;
        const availableBooks = this.books.reduce((sum, book) => sum + book.availableCopies, 0);
        const borrowedBooks = this.borrowedBooks.filter(b => !b.returnedAt).length;

        document.getElementById('total-books').textContent = totalBooks;
        document.getElementById('unique-titles').textContent = uniqueTitles;
        document.getElementById('available-books').textContent = availableBooks;
        document.getElementById('borrowed-books').textContent = borrowedBooks;
    }

    // 設定視圖模式
    setView(view) {
        const gridBtn = document.getElementById('grid-view');
        const listBtn = document.getElementById('list-view');
        const container = document.getElementById('books-container');

        if (view === 'grid') {
            gridBtn.classList.add('active');
            listBtn.classList.remove('active');
            container.className = 'books-grid';
        } else {
            listBtn.classList.add('active');
            gridBtn.classList.remove('active');
            container.className = 'books-list';
        }
    }

    // 重置資料
    resetData() {
        if (!this.requireAdmin('重置資料')) return;
        if (confirm('確定要重置所有資料嗎？此操作無法復原！')) {
            localStorage.removeItem('lib_books_v1');
            localStorage.removeItem('lib_borrowed_v1');
            localStorage.removeItem('lib_users_v1');
            localStorage.removeItem('lib_active_user_v1');
            localStorage.removeItem('lib_settings_v1');
            localStorage.removeItem('lib_csv_loaded_v1');
            
            this.books = [];
            this.borrowedBooks = [];
            this.users = [];
            this.currentUser = null;
            
            // 重新載入 Google Sheets（改以線上資料為主）
            this.pullFromGoogleSheets({ silent: false, protectEmpty: false, closeModal: false });
            
            this.renderBooks();
            this.renderBorrowedBooks();
            this.updateStats();
            this.updateUserDisplay();
            
            this.showToast('資料已重置，將重新載入線上資料', 'success');
        }
    }
    
    // 重新載入 CSV 資料
    async reloadCSV() {
        if (!this.requireAdmin('重新載入 CSV')) return;
        // 改為重新載入線上 Google Sheets
        this.showToast('正在重新載入線上資料...', 'info');
        await this.pullFromGoogleSheets({ silent: false, protectEmpty: false, closeModal: false });
    }


    // 開始自動更新
    startAutoUpdate() {
        if (!this.isAdminUser()) {
            this.stopAutoUpdate();
            return;
        }
        // 清除現有的定時器
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }

        // 設定自動更新定時器
        this.updateTimer = setInterval(() => {
            this.autoUpdateBooks();
        }, this.settings.autoUpdateInterval);

        console.log(`自動更新已啟動，每 ${this.settings.autoUpdateInterval / 1000} 秒檢查一次`);
    }

    // 停止自動更新
    stopAutoUpdate() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
            console.log('自動更新已停止');
        }
    }

    // 自動更新書籍資料
    async autoUpdateBooks() {
        try {
            console.log('開始自動更新線上 Google Sheets 資料...');

            await this.pullFromGoogleSheets({ silent: true, protectEmpty: true, closeModal: false });
            this.lastUpdateTime = new Date();
            this.updateLastUpdateDisplay();
        } catch (error) {
            console.error('自動更新失敗:', error);
        }
    }

    // 更新最後更新時間顯示
    updateLastUpdateDisplay() {
        const lastUpdateElement = document.getElementById('last-update-time');
        if (lastUpdateElement && this.lastUpdateTime) {
            const timeString = this.lastUpdateTime.toLocaleString('zh-TW');
            lastUpdateElement.textContent = `最後更新：${timeString}`;
        }
    }

    // 切換自動更新狀態
    toggleAutoUpdate() {
        if (!this.requireAdmin('自動更新')) return;
        const button = document.getElementById('toggle-auto-update-btn');
        const statusElement = document.getElementById('auto-update-status');
        
        if (this.updateTimer) {
            // 停止自動更新
            this.stopAutoUpdate();
            button.innerHTML = '<i class="fas fa-play"></i> 啟動自動更新';
            button.className = 'btn btn-warning';
            statusElement.innerHTML = '<i class="fas fa-circle" style="color: #ff6b6b;"></i> 自動更新已停止';
            this.showToast('自動更新已停止', 'warning');
        } else {
            // 啟動自動更新
            this.startAutoUpdate();
            button.innerHTML = '<i class="fas fa-pause"></i> 停止自動更新';
            button.className = 'btn btn-success';
            statusElement.innerHTML = '<i class="fas fa-circle" style="color: #28a745;"></i> 自動更新已啟動';
            this.showToast('自動更新已啟動', 'success');
        }
    }

    // 顯示載入指示器
    showLoadingIndicator(show) {
        const statusElement = document.getElementById('auto-update-status');
        if (statusElement) {
            if (show) {
                statusElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在載入最新資料...';
                statusElement.style.color = '#007bff';
            } else {
                // 恢復正常狀態顯示
                if (this.updateTimer) {
                    statusElement.innerHTML = '<i class="fas fa-circle" style="color: #28a745;"></i> 自動更新已啟動';
                } else {
                    statusElement.innerHTML = '<i class="fas fa-circle" style="color: #ff6b6b;"></i> 自動更新已停止';
                }
            }
        }
    }

    // 跳轉到博幼藏書頁面
    goToBoyouBooks() {
        window.location.href = 'boyou-books.html';
    }

    // 顯示通知
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type}`;
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    // 匯出借閱清單為 Excel
    exportBorrowedToExcel() {
        if (!this.currentUser) {
            this.showToast('請先登入後再匯出', 'error');
            return;
        }

        // 依角色決定匯出內容（與畫面一致：staff 匯出全部未歸還，其餘僅匯出自己的未歸還）
        let records;
        if (this.currentUser.role === 'staff') {
            records = this.borrowedBooks.filter(b => !b.returnedAt);
        } else {
            records = this.borrowedBooks.filter(b => b.userId === this.currentUser.username && !b.returnedAt);
        }

        if (!records || records.length === 0) {
            this.showToast('沒有可匯出的借閱記錄', 'warning');
            return;
        }

        // 老師/館員：單一檔案、每位借閱者一個工作表
        if (this.currentUser.role === 'staff') {
            const grouped = new Map();
            records.forEach(r => {
                if (!grouped.has(r.userId)) grouped.set(r.userId, []);
                grouped.get(r.userId).push(r);
            });

            const dateStr = new Date().toISOString().slice(0, 10);
            const header = ['借閱編號', '書碼', '書名', '借閱者', '借閱日期'];

            const wb = XLSX.utils.book_new();

            const sanitizeSheetName = (name) => {
                const invalid = /[\\\/:\*\?\[\]]/g; // Excel 禁止字元
                let safe = String(name).replace(invalid, ' ');
                if (!safe.trim()) safe = '借閱者';
                if (safe.length > 31) safe = safe.slice(0, 31);
                return safe;
            };

            grouped.forEach((userRecords, userId) => {
                const rows = userRecords.map(r => {
                    const borrowDate = new Date(r.borrowDate);
                    return [
                        r.id,
                        r.bookId,
                        r.bookTitle,
                        r.userId,
                        borrowDate.toLocaleDateString('zh-TW')
                    ];
                });

                const aoa = [header, ...rows];
                const ws = XLSX.utils.aoa_to_sheet(aoa);
                const colWidths = header.map((h, idx) => {
                    const maxLen = Math.max(
                        h.length,
                        ...rows.map(row => (row[idx] !== undefined && row[idx] !== null ? String(row[idx]).length : 0))
                    );
                    return { wch: Math.min(Math.max(maxLen + 2, 8), 40) };
                });
                ws['!cols'] = colWidths;

                const sheetName = sanitizeSheetName(userId);
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            });

            const filename = `借閱清單_全部_${dateStr}.xlsx`;
            XLSX.writeFile(wb, filename);
            this.showToast('已匯出單一檔案（多工作表）', 'success');
            return;
        }

        // 學生/訪客：只匯出自己的活頁簿
        const header = ['借閱編號', '書碼', '書名', '借閱者', '借閱日期'];
        const rows = records.map(r => {
            const borrowDate = new Date(r.borrowDate);
            return [
                r.id,
                r.bookId,
                r.bookTitle,
                r.userId,
                borrowDate.toLocaleDateString('zh-TW')
            ];
        });

        const aoa = [header, ...rows];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const colWidths = header.map((h, idx) => {
            const maxLen = Math.max(
                h.length,
                ...rows.map(row => (row[idx] !== undefined && row[idx] !== null ? String(row[idx]).length : 0))
            );
            return { wch: Math.min(Math.max(maxLen + 2, 8), 40) };
        });
        ws['!cols'] = colWidths;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '借閱清單');
        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `借閱清單_${this.currentUser.username}_${dateStr}.xlsx`;
        XLSX.writeFile(wb, filename);
        this.showToast('已匯出借閱清單', 'success');
    }

}

// 初始化系統
const library = new LibrarySystem();

// 全域函數（供HTML調用）
window.library = library;
