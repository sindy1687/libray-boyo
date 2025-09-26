// 圖書館管理系統核心功能
class LibrarySystem {
    constructor() {
        this.books = [];
        this.borrowedBooks = [];
        this.users = [];
        this.currentUser = null;
        this.settings = {
            loanDays: 14,
            guestBorrow: false,
            defaultCopies: 1,
            defaultYear: 2024,
            autoUpdateInterval: 300000 // 5分鐘自動更新一次
        };
        this.updateTimer = null;
        this.lastUpdateTime = null;
        
        this.init();
    }

    // 初始化系統
    init() {
        this.loadData();
        this.setupEventListeners();
        this.autoLoadCSV();
        this.renderBooks();
        this.renderBorrowedBooks();
        this.updateStats();
        this.updateUserDisplay();
        this.startAutoUpdate();
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
        document.getElementById('file-input').addEventListener('change', (e) => this.importBooks(e));
        document.getElementById('add-book-btn').addEventListener('click', () => this.showAddBookModal());
        document.getElementById('reload-csv-btn').addEventListener('click', () => this.reloadCSV());
        document.getElementById('toggle-auto-update-btn').addEventListener('click', () => this.toggleAutoUpdate());
        document.getElementById('reset-btn').addEventListener('click', () => this.resetData());

        // 登入/登出
        document.getElementById('login-btn').addEventListener('click', () => this.showLoginModal());
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());

        // 模態框
        this.setupModalListeners();

        // 表單提交
        document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('add-book-form').addEventListener('submit', (e) => this.handleAddBook(e));

        // 視圖切換
        document.getElementById('grid-view').addEventListener('click', () => this.setView('grid'));
        document.getElementById('list-view').addEventListener('click', () => this.setView('list'));
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

    // 載入資料
    loadData() {
        this.books = JSON.parse(localStorage.getItem('lib_books_v1') || '[]');
        this.borrowedBooks = JSON.parse(localStorage.getItem('lib_borrowed_v1') || '[]');
        this.users = JSON.parse(localStorage.getItem('lib_users_v1') || '[]');
        this.currentUser = JSON.parse(localStorage.getItem('lib_active_user_v1') || 'null');
        this.settings = JSON.parse(localStorage.getItem('lib_settings_v1') || JSON.stringify(this.settings));
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
        document.getElementById('add-book-modal').style.display = 'block';
        
        // 設定預設值
        document.getElementById('book-year').value = this.settings.defaultYear;
        document.getElementById('book-copies').value = this.settings.defaultCopies;
        
        // 清空表單
        document.getElementById('add-book-form').reset();
        
        // 重新設定預設值（因為reset會清空）
        document.getElementById('book-year').value = this.settings.defaultYear;
        document.getElementById('book-copies').value = this.settings.defaultCopies;
        
        // 聚焦到書碼輸入框
        setTimeout(() => {
            document.getElementById('book-id').focus();
        }, 100);
        
        // 添加實時驗證
        this.setupAddBookValidation();
    }

    // 處理新增書籍
    handleAddBook(e) {
        e.preventDefault();
        const id = document.getElementById('book-id').value.trim();
        const title = document.getElementById('book-title').value.trim();
        const year = parseInt(document.getElementById('book-year').value) || this.settings.defaultYear;
        const copies = parseInt(document.getElementById('book-copies').value) || this.settings.defaultCopies;

        // 驗證書碼格式（支援全形和半形字符）
        if (!/^[ABC]\d+$/.test(id)) {
            this.showToast('書碼首字母需為 A/B/C', 'error');
            return;
        }

        // 檢查重複書碼
        if (this.books.find(book => book.id === id)) {
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
            genre,
            year,
            copies,
            availableCopies: copies
        };

        this.books.push(newBook);
        this.saveData();
        this.renderBooks();
        this.updateStats();
        
        document.getElementById('add-book-modal').style.display = 'none';
        document.getElementById('add-book-form').reset();
        this.showToast('書籍新增成功！', 'success');
    }

    // 設定新增書籍表單的實時驗證
    setupAddBookValidation() {
        const bookIdInput = document.getElementById('book-id');
        const bookTitleInput = document.getElementById('book-title');
        
        // 書碼格式驗證
        bookIdInput.addEventListener('input', (e) => {
            const value = e.target.value.trim();
            const isValid = /^[ABC]\d*$/.test(value);
            
            if (value && !isValid) {
                e.target.style.borderColor = '#f56565';
                this.showFieldError('book-id', '書碼格式：A/B/C + 數字');
            } else {
                e.target.style.borderColor = '#e2e8f0';
                this.hideFieldError('book-id');
            }
        });
        
        // 書名驗證
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

        // 檢查是否已借閱此書
        const existingBorrow = this.borrowedBooks.find(
            b => b.bookId === bookId && b.userId === this.currentUser.username && !b.returnedAt
        );

        if (existingBorrow) {
            this.showToast('您已借閱此書籍', 'error');
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
        this.renderBooks();
        this.renderBorrowedBooks();
        this.updateStats();
        this.showToast('歸還成功！', 'success');
    }

    // 渲染書籍列表
    renderBooks() {
        console.log('開始渲染書籍，當前書籍數量:', this.books.length);
        const container = document.getElementById('books-container');
        const searchTerm = document.getElementById('search-input').value.toLowerCase();
        const genreFilter = document.getElementById('genre-filter').value;
        const sortBy = document.getElementById('sort-by').value;
        const sortOrder = document.getElementById('sort-order').value;

        let filteredBooks = this.books.filter(book => {
            const matchesSearch = !searchTerm || 
                book.title.toLowerCase().includes(searchTerm) ||
                book.id.toLowerCase().includes(searchTerm) ||
                (book.bookIds && book.bookIds.some(id => id.toLowerCase().includes(searchTerm))) ||
                book.year.toString().includes(searchTerm) ||
                book.genre.includes(searchTerm);
            
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

        const isBorrowed = this.borrowedBooks.some(
            b => b.bookId === book.id && b.userId === this.currentUser?.username && !b.returnedAt
        );

        // 顯示書碼資訊
        const bookIdsDisplay = book.bookIds && book.bookIds.length > 1 
            ? `${book.id} 等${book.bookIds.length}本` 
            : book.id;

        return `
            <div class="book-card genre-${book.genre} ${book.availableCopies === 0 ? 'borrowed' : ''} ${book.bookIds && book.bookIds.length > 1 ? 'merged' : ''}">
                <div class="book-header">
                    <span class="book-id">${bookIdsDisplay}</span>
                    <span class="book-genre">${book.genre}</span>
                </div>
                <div class="book-title">${book.title}</div>
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
                    ${canBorrow && !isBorrowed ? 
                        `<button class="btn btn-primary btn-small" onclick="library.borrowBook('${book.id}')">
                            <i class="fas fa-book-reader"></i> 借閱
                        </button>` : 
                        `<button class="btn btn-outline btn-small" disabled>
                            <i class="fas fa-ban"></i> ${isBorrowed ? '已借閱' : '無法借閱'}
                        </button>`
                    }
                </div>
            </div>
        `;
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
            
            // 重新載入 CSV
            this.autoLoadCSV();
            
            this.renderBooks();
            this.renderBorrowedBooks();
            this.updateStats();
            this.updateUserDisplay();
            
            this.showToast('資料已重置，將重新載入博幼館藏', 'success');
        }
    }
    
    // 重新載入 CSV 資料
    async reloadCSV() {
        this.showToast('正在重新載入資料...', 'info');
        this.books = [];
        await this.autoLoadCSV();
        this.renderBooks();
        this.updateStats();
    }


    // 開始自動更新
    startAutoUpdate() {
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
            console.log('開始自動更新本地 CSV 資料...');
            
            // 載入本地 CSV 資料
            const response = await fetch('113博幼館藏.csv');
            if (response.ok) {
                const csvText = await response.text();
                const csvData = this.parseCSV(csvText);
                
                if (csvData.length > 0) {
                    // 載入新資料
                    this.showLoadingIndicator(true);
                    this.books = [];
                    this.processCSVData(csvData);
                    this.renderBooks();
                    this.updateStats();
                    this.lastUpdateTime = new Date();
                    this.updateLastUpdateDisplay();
                    
                    console.log(`自動更新完成：載入 ${csvData.length} 筆資料`);
                    this.showToast(`書籍資料已自動更新 (${csvData.length} 筆)`, 'success');
                    this.showLoadingIndicator(false);
                }
            } else {
                console.log('本地 CSV 載入失敗');
            }
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

}

// 初始化系統
const library = new LibrarySystem();

// 全域函數（供HTML調用）
window.library = library;
