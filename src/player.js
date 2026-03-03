// ============================================================
// Bingo Pro Max — Player Client (Multi-Card Selection + Batch Payment)
// ============================================================

let playerName = '';
let socket = null;
let calledNumbers = new Set();
let myCards = new Set();       // Serials de mis cartones (cualquier estado)
let myCardStatuses = {};       // { serial: 'reserved' | 'payment_sent' | 'confirmed' }
let allCards = [];
let cardPrice = 0;
let currentTab = 'store';

// Carrito de selección
let selectedCards = new Set();  // Serials seleccionados para comprar

// Payment modal
let activePaymentSerials = []; // Serials en el modal de pago actual
let paymentTimerInterval = null;
let salesLocked = false;        // Bloqueo de ventas cuando la partida comienza
let markingMode = 'auto';       // 'manual' | 'auto'
let currentGameMode = 'figure'; // Modo de juego actual
let animatorPaymentConfig = { bank: '', phone: '', cedula: '' };
let manualMarks = {};           // { serial: Set<value> } para preservar marcas manuales
let totalPrize = 0;             // Pote total del juego
let gamePaused = false;         // Juego pausado mientras se verifica un canto
let currentGameId = '';         // ID único de la partida actual
let currentSelectedFigure = 'X'; // Figura seleccionada por el animador

// ============================================================
// Login
// ============================================================
const playerNameInput = document.getElementById('playerNameInput');
const joinGameBtn = document.getElementById('joinGameBtn');
const loginScreen = document.getElementById('loginScreen');
const gameView = document.getElementById('gameView');

playerNameInput.addEventListener('input', () => {
    joinGameBtn.disabled = playerNameInput.value.trim().length === 0;
});

playerNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && playerNameInput.value.trim().length > 0) {
        joinGame();
    }
});

joinGameBtn.addEventListener('click', joinGame);

function joinGame() {
    playerName = playerNameInput.value.trim();
    if (!playerName) return;

    document.getElementById('displayPlayerName').textContent = playerName;

    loginScreen.style.transition = 'opacity 0.4s';
    loginScreen.style.opacity = '0';
    setTimeout(() => {
        loginScreen.style.display = 'none';
        gameView.classList.remove('hidden');
        initSocket();
        loadInitialState();
    }, 400);
}

// ============================================================
// Socket.IO Connection
// ============================================================
function initSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('[PLAYER] Conectado:', socket.id);
        setConnectionStatus(true);
    });

    socket.on('disconnect', () => {
        console.log('[PLAYER] Desconectado');
        setConnectionStatus(false);
    });

    socket.on('cards-updated', (data) => {
        allCards = data.cards;
        cardPrice = data.cardPrice;
        myCards.clear();
        myCardStatuses = {};
        calledNumbers.clear();
        selectedCards.clear();
        salesLocked = false;
        markingMode = 'auto';
        manualMarks = {};
        updateCartBar();
        closePaymentModal();
        renderStore();
        renderMyCards();
        updateStats();
        showToast('El animador generó nuevos cartones. ¡Ve a la tienda!', 'info');
    });

    socket.on('card-purchased', (data) => {
        const card = allCards.find(c => String(c.serial) === String(data.serial));
        if (card) {
            card.status = data.status || 'reserved';
            card.buyer = data.buyer;
            card.reservedAt = data.reservedAt;
        }

        if (data.buyer === playerName) {
            myCards.add(String(data.serial));
            myCardStatuses[data.serial] = data.status || 'reserved';
            // Quitar de seleccionados (ya se reservó)
            selectedCards.delete(String(data.serial));
        }

        updateCartBar();
        renderStore();
        renderMyCards();
        updateStats();
    });

    socket.on('card-released', (data) => {
        const card = allCards.find(c => String(c.serial) === String(data.serial));
        if (card) {
            card.status = 'available';
            card.buyer = null;
        }

        if (data.buyer === playerName) {
            myCards.delete(String(data.serial));
            delete myCardStatuses[data.serial];

            const idx = activePaymentSerials.indexOf(String(data.serial));
            if (idx !== -1) {
                activePaymentSerials.splice(idx, 1);
                if (activePaymentSerials.length === 0) {
                    closePaymentModal();
                    showToast('Tus reservas fueron liberadas.', 'warning');
                }
            }
        }

        renderStore();
        renderMyCards();
        updateStats();
    });

    socket.on('payment-confirmed', (data) => {
        const card = allCards.find(c => String(c.serial) === String(data.serial));
        if (card) card.status = 'confirmed';

        if (myCards.has(String(data.serial))) {
            myCardStatuses[data.serial] = 'confirmed';
            const idx = activePaymentSerials.indexOf(String(data.serial));
            if (idx !== -1) {
                activePaymentSerials.splice(idx, 1);
                if (activePaymentSerials.length === 0) {
                    closePaymentModal();
                }
            }
            showToast(`¡Pago confirmado! Cartón #${data.serial} es tuyo.`, 'success');
        }

        renderStore();
        renderMyCards();
        updateStats();
    });

    socket.on('new-ball', (data) => {
        calledNumbers = new Set(data.calledNumbers);
        updateBallDisplay(data.number, data.lastBalls, data.ballCount);
        markMyCards();
    });

    // === GAME-STARTED: ventas cerradas ===
    socket.on('game-started', (data) => {
        salesLocked = true;
        allCards = data.cards;
        selectedCards.clear();
        updateCartBar();
        closePaymentModal();

        // Actualizar myCards con los cartones que quedaron
        myCards.clear();
        myCardStatuses = {};
        allCards.forEach(c => {
            if (c.buyer === playerName) {
                myCards.add(String(c.serial));
                myCardStatuses[c.serial] = c.status || 'confirmed';
            }
        });

        // Determinar modo de marcado
        const confirmedCount = Object.values(myCardStatuses).filter(s => s === 'confirmed').length;
        if (confirmedCount <= 3) {
            markingMode = 'manual';
            showToast('🖐 Modo manual activado. Marca tus cartones tocando las celdas.', 'info');
        } else {
            // Mostrar modal de selección
            showModeSelectionModal();
        }

        // Guardar pote y modo de juego
        totalPrize = data.totalPrize || 0;
        if (data.gameMode) currentGameMode = data.gameMode;
        if (data.selectedFigure) currentSelectedFigure = data.selectedFigure;
        if (data.gameId) currentGameId = data.gameId;
        updatePrizeDisplay();

        renderStore();
        renderMyCards();
        updateStats();
        updateSingButtons();

        if (data.removedCount > 0) {
            showToast(`🎯 La partida comenzó. ${data.removedCount} cartón(es) no vendido(s) fueron retirados.`, 'warning');
        } else {
            showToast('🎯 La partida ha comenzado. ¡Buena suerte!', 'info');
        }
    });

    // === PAYMENT CONFIG UPDATED ===
    socket.on('payment-config-updated', (data) => {
        animatorPaymentConfig = data;
        updatePaymentConfigDisplay();
    });

    socket.on('winner-announced', (data) => {
        const isMyCard = myCards.has(String(data.cardIndex));
        if (isMyCard) {
            showToast(`🎉 ¡FELICIDADES! Tu cartón #${data.cardIndex} ganó ${data.prizeType}!`, 'success');
            markCardAsWinner(data.cardIndex, data.prizeType);
        } else {
            showToast(`Cartón #${data.cardIndex} ganó ${data.prizeType}.`, 'warning');
        }

        if (data.nextMode) {
            currentGameMode = data.nextMode;
            const modeDisplay = document.getElementById('gameModeDisplay');
            if (data.nextMode === 'line') modeDisplay.textContent = 'Línea';
            else if (data.nextMode === 'bingo') modeDisplay.textContent = 'Bingo';
            else if (data.nextMode === 'figure') modeDisplay.textContent = 'Figura';
            updateSingButtons();
        }
    });

    // === GAME-PAUSED: alguien cantó ===
    socket.on('game-paused', (data) => {
        gamePaused = true;
        showClaimOverlay(data);
    });

    // === CLAIM-RESULT: resultado de verificación ===
    socket.on('claim-result', (data) => {
        gamePaused = false;
        hideClaimOverlay();
        if (data.valid) {
            showToast(`✅ "${data.playerName}" ganó ${data.claimType} con cartón #${data.cardSerial}. ¡Verificado!`, 'success');
        } else {
            showToast(`❌ El canto de "${data.playerName}" (${data.claimType}) fue rechazado. El juego continúa.`, 'warning');
        }
    });

    // === GAME-ENDED: Bingo validado, partida finalizada ===
    socket.on('game-ended', (data) => {
        hideClaimOverlay();
        gamePaused = false;
        showPlayerGameEndedModal(data);
    });

    // === GAME-BREAK: Receso ===
    socket.on('game-break', (data) => {
        showToast(`⏸️ Receso de ${data.minutes} minuto(s). Pronto se reanudará.`, 'info');
    });

    socket.on('game-reset', () => {
        allCards = [];
        myCards.clear();
        myCardStatuses = {};
        calledNumbers.clear();
        cardPrice = 0;
        selectedCards.clear();
        salesLocked = false;
        markingMode = 'auto';
        manualMarks = {};
        updateCartBar();
        closePaymentModal();
        renderStore();
        renderMyCards();
        updateStats();
        resetBallDisplay();
        showToast('El animador inició una nueva partida.', 'info');
    });

    socket.on('sync-state', (data) => {
        calledNumbers = new Set(data.calledNumbers || []);
        allCards = data.cards || [];
        cardPrice = data.cardPrice || 0;

        allCards.forEach(c => {
            if (c.buyer === playerName) {
                myCards.add(String(c.serial));
                myCardStatuses[c.serial] = c.status || 'reserved';
            }
        });

        if (data.currentNumber) {
            updateBallDisplay(data.currentNumber, data.lastBalls || [], data.ballCount || 0);
        }
        if (data.gameMode) {
            currentGameMode = data.gameMode;
            const modeDisplay = document.getElementById('gameModeDisplay');
            if (data.gameMode === 'figure') modeDisplay.textContent = 'Figura';
            else if (data.gameMode === 'line') modeDisplay.textContent = 'Línea';
            else if (data.gameMode === 'bingo') modeDisplay.textContent = 'Bingo';
        }

        // Cargar paymentConfig del sync
        if (data.paymentConfig) {
            animatorPaymentConfig = data.paymentConfig;
            updatePaymentConfigDisplay();
        }

        renderStore();
        renderMyCards();
        updateStats();
    });
}

function setConnectionStatus(connected) {
    const dot = document.getElementById('connectionDot');
    dot.className = connected ? 'connection-dot connected' : 'connection-dot disconnected';
}

// ============================================================
// Initial Load via API
// ============================================================
async function loadInitialState() {
    try {
        const [cardsRes, stateRes] = await Promise.all([
            fetch('/api/cards'),
            fetch('/api/game-state')
        ]);

        if (cardsRes.ok) {
            const cardsData = await cardsRes.json();
            allCards = cardsData.cards || [];
            cardPrice = cardsData.cardPrice || 0;

            allCards.forEach(c => {
                if (c.buyer === playerName) {
                    myCards.add(String(c.serial));
                    myCardStatuses[c.serial] = c.status || 'reserved';
                }
            });
        }

        if (stateRes.ok) {
            const stateData = await stateRes.json();
            calledNumbers = new Set(stateData.calledNumbers || []);

            // Verificar si la partida ya comenzó
            if (stateData.gameStarted) {
                salesLocked = true;
            }

            if (stateData.currentNumber) {
                updateBallDisplay(stateData.currentNumber, stateData.lastBalls || [], stateData.ballCount || 0);
            }
            currentGameMode = stateData.gameMode;
            const modeDisplay = document.getElementById('gameModeDisplay');
            if (stateData.gameMode === 'figure') modeDisplay.textContent = 'Figura';
            else if (stateData.gameMode === 'line') modeDisplay.textContent = 'Línea';
            else if (stateData.gameMode === 'bingo') modeDisplay.textContent = 'Bingo';
        }

        // Cargar paymentConfig
        if (stateRes.ok) {
            try {
                const pcRes = await fetch('/api/payment-config');
                if (pcRes.ok) {
                    animatorPaymentConfig = await pcRes.json();
                    updatePaymentConfigDisplay();
                }
            } catch (e) { /* ignore */ }
        }

        renderStore();
        renderMyCards();
        updateStats();
    } catch (err) {
        console.error('Error cargando estado inicial:', err);
    }
}

// ============================================================
// Ball Display
// ============================================================
function getLetterForNumber(number) {
    if (number >= 1 && number <= 15) return 'B';
    if (number >= 16 && number <= 30) return 'I';
    if (number >= 31 && number <= 45) return 'N';
    if (number >= 46 && number <= 60) return 'G';
    if (number >= 61 && number <= 75) return 'O';
    return '';
}

function updateBallDisplay(number, lastBalls, ballCount) {
    const currentBall = document.getElementById('currentBallDisplay');
    currentBall.textContent = getLetterForNumber(number) + number;
    currentBall.classList.remove('pulse');
    void currentBall.offsetWidth;
    currentBall.classList.add('pulse');

    document.getElementById('ballCountDisplay').innerHTML = `${ballCount}<span class="text-gray-500 text-sm">/75</span>`;

    const container = document.getElementById('lastBallsDisplay');
    container.innerHTML = '';
    if (lastBalls.length === 0) {
        container.innerHTML = '<span class="text-gray-500 text-sm italic">Esperando...</span>';
    } else {
        lastBalls.forEach(b => {
            const div = document.createElement('div');
            div.className = 'mini-ball';
            div.textContent = b;
            container.appendChild(div);
        });
    }

    // Update floating ball tracker for small screens
    const floatingBall = document.getElementById('floatingBallNumber');
    if (floatingBall) {
        floatingBall.textContent = getLetterForNumber(number) + number;
    }
    const floatingLast = document.getElementById('floatingLastBalls');
    if (floatingLast) {
        floatingLast.innerHTML = '';
        const last3 = lastBalls.slice(0, 3);
        last3.forEach(b => {
            const span = document.createElement('span');
            span.className = 'floating-mini-ball';
            span.textContent = b;
            floatingLast.appendChild(span);
        });
    }
}

function resetBallDisplay() {
    document.getElementById('currentBallDisplay').textContent = '?';
    document.getElementById('ballCountDisplay').innerHTML = '0<span class="text-gray-500 text-sm">/75</span>';
    document.getElementById('lastBallsDisplay').innerHTML = '<span class="text-gray-500 text-sm italic">Esperando...</span>';
    document.getElementById('gameModeDisplay').textContent = '—';
}

// ============================================================
// Tabs
// ============================================================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const tabId = btn.getAttribute('data-tab');
        document.getElementById(`tab-${tabId}`).classList.add('active');
        currentTab = tabId;
    });
});

// ============================================================
// Stats
// ============================================================
function updateStats() {
    document.getElementById('myCardsCount').textContent = myCards.size;
    document.getElementById('storePriceDisplay').textContent = `$${cardPrice}`;
    const available = allCards.filter(c => c.status === 'available').length;
    document.getElementById('storeAvailableDisplay').textContent = available;
}

// ============================================================
// Cart Bar
// ============================================================
function updateCartBar() {
    const bar = document.getElementById('cartBar');
    const count = selectedCards.size;

    if (count === 0) {
        bar.classList.add('hidden');
        return;
    }

    bar.classList.remove('hidden');
    document.getElementById('cartCount').textContent = count;
    document.getElementById('cartLabel').textContent = `${count} cartón${count > 1 ? 'es' : ''} seleccionado${count > 1 ? 's' : ''}`;
    document.getElementById('cartTotal').textContent = `Total: $${count * cardPrice}`;
    if (window.lucide) window.lucide.createIcons();
}

// Cart buttons
document.getElementById('clearCartBtn').addEventListener('click', () => {
    selectedCards.clear();
    updateCartBar();
    renderStore();
});

document.getElementById('checkoutBtn').addEventListener('click', () => {
    if (selectedCards.size === 0) return;
    checkoutCart();
});

// Toggle card selection
function toggleCardSelection(serial) {
    if (salesLocked) {
        showToast('La partida ya comenzó. No se pueden comprar más cartones.', 'warning');
        return;
    }
    serial = String(serial);
    if (selectedCards.has(serial)) {
        selectedCards.delete(serial);
    } else {
        selectedCards.add(serial);
    }
    updateCartBar();
    renderStore();
}

// ============================================================
// Checkout — Reserve all selected cards, then show payment modal
// ============================================================
async function checkoutCart() {
    if (salesLocked) {
        showToast('La partida ya comenzó. No se pueden comprar más cartones.', 'warning');
        return;
    }
    const serials = Array.from(selectedCards);
    if (serials.length === 0) return;

    try {
        const res = await fetch('/api/cards/buy-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, serials })
        });

        const data = await res.json();

        if (res.ok) {
            const reservedAt = data.reservedAt || new Date().toISOString();

            for (const serial of data.serials) {
                myCards.add(String(serial));
                myCardStatuses[serial] = 'reserved';

                const card = allCards.find(c => String(c.serial) === String(serial));
                if (card) {
                    card.status = 'reserved';
                    card.buyer = playerName;
                    card.reservedAt = reservedAt;
                }
            }

            selectedCards.clear();
            updateCartBar();
            renderStore();
            renderMyCards();
            updateStats();

            // Abrir modal de pago con todos los cartones reservados
            openPaymentModal(data.serials, reservedAt);
            showToast(`${data.serials.length} cartón(es) reservado(s). Tienes 10 minutos para pagar.`, 'info');
        } else {
            showToast(data.error || 'Error al reservar cartones.', 'error');
            if (data.conflicts) {
                data.conflicts.forEach(c => {
                    selectedCards.delete(String(c.serial));
                });
                updateCartBar();
                renderStore();
            }
        }
    } catch (err) {
        console.error('Error en checkout:', err);
        showToast('Error de conexión.', 'error');
    }
}

// ============================================================
// Store Rendering — Click to select (available) or open payment (reserved mine)
// ============================================================
function renderStore() {
    const grid = document.getElementById('storeGrid');
    grid.innerHTML = '';

    if (allCards.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <i data-lucide="clock" class="w-16 h-16"></i>
                <p>Esperando a que el animador genere los cartones...</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    // Si las ventas están cerradas, mostrar aviso
    if (salesLocked) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <i data-lucide="lock" class="w-16 h-16" style="color: #f59e0b;"></i>
                <p style="color: #fbbf24; font-weight: 600;">🎯 Ventas cerradas — La partida ha comenzado</p>
                <p style="color: #9ca3af; font-size: 0.85rem;">Ve a la pestaña "Mis Cartones" para seguir tu juego.</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    allCards.forEach(card => {
        const serial = String(card.serial);
        const isMine = myCards.has(serial);
        const isSelected = selectedCards.has(serial);
        const cardStatus = card.status || 'available';
        const isAvailable = cardStatus === 'available';

        let statusClass, statusText;
        if (isSelected) {
            statusClass = 'available selected';
            statusText = '✓ Seleccionado';
        } else if (isMine) {
            const myStatus = myCardStatuses[card.serial] || 'reserved';
            if (myStatus === 'confirmed') {
                statusClass = 'mine';
                statusText = '✓ Confirmado';
            } else if (myStatus === 'payment_sent') {
                statusClass = 'mine';
                statusText = '⏳ Verificando';
            } else {
                statusClass = 'reserved';
                statusText = '⏱ Reservado';
            }
        } else if (isAvailable) {
            statusClass = 'available';
            statusText = 'Disponible';
        } else {
            statusClass = 'purchased';
            statusText = 'Vendido';
        }

        const cardEl = document.createElement('div');
        cardEl.className = `store-card glass-panel ${statusClass}`;

        // Build mini grid
        let miniGridHtml = '';
        'BINGO'.split('').forEach(letter => {
            miniGridHtml += `<div class="mini-header">${letter}</div>`;
        });

        if (card.numbers) {
            for (let row = 0; row < 5; row++) {
                'BINGO'.split('').forEach((letter) => {
                    const val = card.numbers[letter] ? card.numbers[letter][row] : '';
                    const isFree = val === 'FREE';
                    const isMarked = !isFree && calledNumbers.has(parseInt(val));
                    const classes = isFree ? 'mini-cell free' : isMarked ? 'mini-cell marked' : 'mini-cell';
                    miniGridHtml += `<div class="${classes}">${isFree ? '★' : val}</div>`;
                });
            }
        }

        // Selection checkbox for available cards
        let selectCheckHtml = '';
        if (isAvailable || isSelected) {
            selectCheckHtml = `<div class="select-check">${isSelected ? '<i data-lucide="check" class="w-3.5 h-3.5 text-white"></i>' : ''}</div>`;
        }

        let buyBtnHtml;
        if (isAvailable || isSelected) {
            const btnText = isSelected ? 'Quitar' : 'Seleccionar';
            const btnStyle = isSelected
                ? 'background: rgba(99, 102, 241, 0.3); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.4);'
                : '';
            buyBtnHtml = `<button class="buy-btn available" onclick="toggleCardSelection('${card.serial}')" style="${btnStyle}">${btnText}</button>`;
        } else if (isMine) {
            const myStatus = myCardStatuses[card.serial] || 'reserved';
            if (myStatus === 'reserved') {
                buyBtnHtml = `<button class="buy-btn available" onclick="openPaymentModalForReserved()" style="background: linear-gradient(135deg, #f59e0b, #d97706); box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);">Pagar</button>`;
            } else {
                buyBtnHtml = `<button class="buy-btn sold" disabled>${myStatus === 'confirmed' ? 'Confirmado' : 'Verificando'}</button>`;
            }
        } else {
            buyBtnHtml = `<button class="buy-btn sold" disabled>Vendido</button>`;
        }

        // Click handler on the card itself (for available cards)
        const clickHandler = (isAvailable || isSelected) ? `onclick="toggleCardSelection('${card.serial}')"` : '';
        const cursorStyle = (isAvailable || isSelected) ? 'cursor: pointer;' : '';

        cardEl.innerHTML = `
            ${selectCheckHtml}
            <div class="card-header-gradient"></div>
            <div class="card-serial-badge">Cartón #${card.serial}</div>
            <div class="card-status-badge">${statusText}</div>
            <div class="mini-grid">${miniGridHtml}</div>
            <div class="card-buy-area">
                <div class="card-price">$${cardPrice}</div>
                ${buyBtnHtml}
            </div>
        `;

        grid.appendChild(cardEl);
    });

    if (window.lucide) window.lucide.createIcons();
}

// ============================================================
// Payment Modal (Multi-card)
// ============================================================
function openPaymentModal(serials, reservedAt) {
    activePaymentSerials = serials.map(String);
    const modal = document.getElementById('paymentModal');
    const cardInfo = document.getElementById('paymentModalCardInfo');
    const body = document.querySelector('.payment-modal-body');
    const footer = document.querySelector('.payment-modal-footer');
    const waiting = document.getElementById('paymentWaitingState');
    const timer = document.getElementById('paymentTimer');

    const total = activePaymentSerials.length * cardPrice;
    cardInfo.textContent = `${activePaymentSerials.length} cartón(es) — Total: $${total}`;

    // Check if all already sent payment
    const allSent = activePaymentSerials.every(s => myCardStatuses[s] === 'payment_sent');
    if (allSent) {
        body.classList.add('hidden');
        footer.classList.add('hidden');
        waiting.classList.remove('hidden');
        timer.style.display = 'none';
    } else {
        body.classList.remove('hidden');
        footer.classList.remove('hidden');
        waiting.classList.add('hidden');
        timer.style.display = 'flex';

        document.getElementById('paymentPhone').value = '';
        document.getElementById('paymentBank').value = '';
        document.getElementById('paymentCedula').value = '';

        startPaymentTimer(reservedAt);
    }

    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
}

// Open modal for already-reserved cards (button on individual cards)
function openPaymentModalForReserved() {
    const reservedSerials = Object.entries(myCardStatuses)
        .filter(([_, status]) => status === 'reserved' || status === 'payment_sent')
        .map(([serial, _]) => serial);

    if (reservedSerials.length === 0) return;

    const card = allCards.find(c => reservedSerials.includes(String(c.serial)));
    const reservedAt = card?.reservedAt || null;
    openPaymentModal(reservedSerials, reservedAt);
}

function closePaymentModal() {
    const modal = document.getElementById('paymentModal');
    modal.classList.add('hidden');
    activePaymentSerials = [];
    if (paymentTimerInterval) {
        clearInterval(paymentTimerInterval);
        paymentTimerInterval = null;
    }
}

function startPaymentTimer(reservedAt) {
    if (paymentTimerInterval) clearInterval(paymentTimerInterval);

    let endTime;
    if (reservedAt) {
        endTime = new Date(reservedAt).getTime() + 10 * 60 * 1000;
    } else {
        endTime = Date.now() + 10 * 60 * 1000;
    }

    const timerText = document.getElementById('paymentTimerText');
    const timerEl = document.getElementById('paymentTimer');

    function updateTimer() {
        const remaining = Math.max(0, endTime - Date.now());
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        timerText.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        if (remaining < 2 * 60 * 1000) {
            timerEl.className = 'payment-timer urgent';
        } else {
            timerEl.className = 'payment-timer';
        }

        if (remaining <= 0) {
            clearInterval(paymentTimerInterval);
            timerText.textContent = '00:00';
        }
    }

    updateTimer();
    paymentTimerInterval = setInterval(updateTimer, 1000);
}

// Submit Payment (batch)
document.getElementById('submitPaymentBtn').addEventListener('click', async () => {
    if (activePaymentSerials.length === 0) return;

    const phone = document.getElementById('paymentPhone').value.trim();
    const bank = document.getElementById('paymentBank').value.trim();
    const cedula = document.getElementById('paymentCedula').value.trim();

    if (!phone || !bank || !cedula) {
        showToast('Por favor completa todos los campos.', 'error');
        return;
    }

    try {
        const res = await fetch('/api/cards/submit-payment-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerName,
                serials: activePaymentSerials,
                phone, bank, cedula
            })
        });

        const data = await res.json();

        if (res.ok) {
            for (const serial of data.updated) {
                myCardStatuses[serial] = 'payment_sent';
                const card = allCards.find(c => String(c.serial) === String(serial));
                if (card) card.status = 'payment_sent';
            }

            document.querySelector('.payment-modal-body').classList.add('hidden');
            document.querySelector('.payment-modal-footer').classList.add('hidden');
            document.getElementById('paymentWaitingState').classList.remove('hidden');
            document.getElementById('paymentTimer').style.display = 'none';

            if (paymentTimerInterval) {
                clearInterval(paymentTimerInterval);
                paymentTimerInterval = null;
            }

            renderStore();
            renderMyCards();
            showToast('Pago enviado. Esperando verificación del animador.', 'success');
            if (window.lucide) window.lucide.createIcons();
        } else {
            showToast(data.error || 'Error al enviar pago.', 'error');
        }
    } catch (err) {
        console.error('Error enviando pago:', err);
        showToast('Error de conexión.', 'error');
    }
});

// Cancel Reservation (batch)
document.getElementById('cancelReservationBtn').addEventListener('click', async () => {
    if (activePaymentSerials.length === 0) return;

    try {
        const res = await fetch('/api/cards/cancel-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, serials: activePaymentSerials })
        });

        if (res.ok) {
            for (const serial of activePaymentSerials) {
                myCards.delete(serial);
                delete myCardStatuses[serial];

                const card = allCards.find(c => String(c.serial) === String(serial));
                if (card) {
                    card.status = 'available';
                    card.buyer = null;
                }
            }

            closePaymentModal();
            renderStore();
            renderMyCards();
            updateStats();
            showToast('Reservas canceladas.', 'info');
        } else {
            const data = await res.json();
            showToast(data.error || 'Error al cancelar.', 'error');
        }
    } catch (err) {
        console.error('Error cancelando:', err);
        showToast('Error de conexión.', 'error');
    }
});

// ============================================================
// My Cards Rendering
// ============================================================
function renderMyCards() {
    const grid = document.getElementById('myCardsGrid');
    grid.innerHTML = '';

    const confirmedCards = allCards.filter(c =>
        myCards.has(String(c.serial)) && myCardStatuses[c.serial] === 'confirmed'
    );

    if (confirmedCards.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <i data-lucide="shopping-bag" class="w-16 h-16"></i>
                <p>Aún no tienes cartones confirmados. Compra y paga para obtener tus cartones.</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        updateSingButtons();
        return;
    }

    const isManual = markingMode === 'manual';

    confirmedCards.forEach(card => {
        const cardEl = document.createElement('div');
        cardEl.className = 'play-card';
        cardEl.id = `play-card-${card.serial}`;

        let gridHtml = '';
        if (card.numbers) {
            for (let row = 0; row < 5; row++) {
                'BINGO'.split('').forEach((letter) => {
                    const val = card.numbers[letter] ? card.numbers[letter][row] : '';
                    const isFree = val === 'FREE';
                    let isMarked;
                    if (isManual) {
                        // En modo manual, solo marcamos FREE automáticamente
                        isMarked = isFree;
                    } else {
                        isMarked = isFree || calledNumbers.has(parseInt(val));
                    }
                    const classes = isFree ? 'bingo-cell free marked' : isMarked ? 'bingo-cell marked' : 'bingo-cell';
                    gridHtml += `<div class="${classes}" data-value="${val}">${isFree ? 'FREE' : val}</div>`;
                });
            }
        }

        cardEl.innerHTML = `
            <div class="play-card-header-bg"></div>
            <div class="play-card-serial">Cartón #${card.serial}</div>
            <div class="bingo-header">
                <div>B</div><div>I</div><div>N</div><div>G</div><div>O</div>
            </div>
            <div class="bingo-grid">${gridHtml}</div>
        `;

        // En modo manual, agregar click handlers a las celdas
        if (isManual) {
            const cells = cardEl.querySelectorAll('.bingo-cell:not(.free)');
            cells.forEach(cell => {
                cell.addEventListener('click', () => {
                    const val = cell.getAttribute('data-value');
                    if (val && calledNumbers.has(parseInt(val))) {
                        cell.classList.toggle('marked');
                        if (cell.classList.contains('marked')) {
                            cell.style.transition = 'none';
                            cell.style.transform = 'scale(1.2)';
                            setTimeout(() => {
                                cell.style.transition = 'transform 0.3s';
                                cell.style.transform = 'scale(0.95)';
                            }, 100);
                        } else {
                            cell.style.transform = '';
                        }
                    } else if (val && !calledNumbers.has(parseInt(val))) {
                        showToast(`El número ${val} aún no ha sido cantado.`, 'warning');
                    }
                });
                cell.style.cursor = 'pointer';
            });
        }

        grid.appendChild(cardEl);
    });

    // Restaurar marcas manuales previas si existen
    if (isManual) {
        restoreManualMarks();
    }

    if (window.lucide) window.lucide.createIcons();
    updateSingButtons();
}

// saveManualMarks / restoreManualMarks — preservar marcas manuales entre re-renders

function saveManualMarks() {
    const cards = document.querySelectorAll('.play-card');
    cards.forEach(cardEl => {
        const serial = cardEl.id.replace('play-card-', '');
        const marked = new Set();
        cardEl.querySelectorAll('.bingo-cell.marked:not(.free)').forEach(cell => {
            marked.add(cell.getAttribute('data-value'));
        });
        manualMarks[serial] = marked;
    });
}

function restoreManualMarks() {
    const cards = document.querySelectorAll('.play-card');
    cards.forEach(cardEl => {
        const serial = cardEl.id.replace('play-card-', '');
        if (manualMarks[serial]) {
            cardEl.querySelectorAll('.bingo-cell:not(.free)').forEach(cell => {
                const val = cell.getAttribute('data-value');
                if (manualMarks[serial].has(val)) {
                    cell.classList.add('marked');
                }
            });
        }
    });
}

function markMyCards() {
    if (markingMode === 'manual') {
        // En modo manual, NO dar pistas. Solo guardar marcas previas.
        saveManualMarks();
        renderStore();
        return;
    }

    // Modo automático: marcar automáticamente
    const myCardElements = document.querySelectorAll('.play-card');
    myCardElements.forEach(cardEl => {
        const cells = cardEl.querySelectorAll('.bingo-cell');
        cells.forEach(cell => {
            const val = cell.getAttribute('data-value');
            if (val && val !== 'FREE' && calledNumbers.has(parseInt(val))) {
                if (!cell.classList.contains('marked')) {
                    cell.classList.add('marked');
                    cell.style.transition = 'none';
                    cell.style.transform = 'scale(1.2)';
                    setTimeout(() => {
                        cell.style.transition = 'transform 0.3s';
                        cell.style.transform = 'scale(0.95)';
                    }, 100);
                }
            }
        });
    });
    renderStore();
}

function markCardAsWinner(serial, prizeType) {
    const cardEl = document.getElementById(`play-card-${serial}`);
    if (!cardEl || cardEl.querySelector('.winner-badge-inline')) return;

    // Crear badge pequeño inline en vez de overlay bloqueante
    const badge = document.createElement('div');
    badge.className = 'winner-badge-inline';
    badge.innerHTML = `🏆 ${prizeType}`;

    // Insertar después del serial del cartón
    const serialEl = cardEl.querySelector('.play-card-serial');
    if (serialEl) {
        serialEl.insertAdjacentElement('afterend', badge);
    } else {
        cardEl.prepend(badge);
    }
}

// ============================================================
// Toast Notifications
// ============================================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// ============================================================
// Payment Config Display
// ============================================================
function updatePaymentConfigDisplay() {
    const infoBox = document.getElementById('paymentConfigInfo');
    if (!infoBox) return;

    if (animatorPaymentConfig.bank || animatorPaymentConfig.phone || animatorPaymentConfig.cedula) {
        document.getElementById('payConfigInfoBank').textContent = animatorPaymentConfig.bank || '—';
        document.getElementById('payConfigInfoPhone').textContent = animatorPaymentConfig.phone || '—';
        document.getElementById('payConfigInfoCedula').textContent = animatorPaymentConfig.cedula || '—';
        infoBox.classList.remove('hidden');
    } else {
        infoBox.classList.add('hidden');
    }
}

// ============================================================
// Mode Selection Modal
// ============================================================
function showModeSelectionModal() {
    const modal = document.getElementById('modeSelectModal');
    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
}

document.getElementById('modeManualBtn').addEventListener('click', () => {
    markingMode = 'manual';
    document.getElementById('modeSelectModal').classList.add('hidden');
    renderMyCards();
    updateSingButtons();
    showToast('🖐 Modo manual activado. Marca tus cartones tocando las celdas.', 'info');
});

document.getElementById('modeAutoBtn').addEventListener('click', () => {
    markingMode = 'auto';
    document.getElementById('modeSelectModal').classList.add('hidden');
    renderMyCards();
    updateSingButtons();
    showToast('⚡ Modo automático activado.', 'info');
});

// ============================================================
// Sing Buttons (Cantar)
// ============================================================
function updateSingButtons() {
    const bar = document.getElementById('singButtonsBar');
    if (!bar) return;

    const confirmedCount = Object.values(myCardStatuses).filter(s => s === 'confirmed').length;
    const isManual = markingMode === 'manual';

    if (isManual && confirmedCount > 0 && salesLocked) {
        bar.classList.remove('hidden');
        bar.style.display = 'flex';

        // Habilitar/deshabilitar botones según modo de juego actual
        const lineBtn = document.getElementById('singLineBtn');
        const figBtn = document.getElementById('singFigureBtn');
        const bingoBtn = document.getElementById('singBingoBtn');

        // Línea: solo cuando el modo actual es 'line' o posterior
        if (lineBtn) {
            const lineEnabled = currentGameMode === 'line';
            lineBtn.disabled = !lineEnabled;
            lineBtn.style.opacity = lineEnabled ? '1' : '0.4';
            lineBtn.style.cursor = lineEnabled ? 'pointer' : 'not-allowed';
        }

        // Figura: solo cuando el modo es 'figure'
        if (figBtn) {
            const figEnabled = currentGameMode === 'figure';
            figBtn.disabled = !figEnabled;
            figBtn.style.opacity = figEnabled ? '1' : '0.4';
            figBtn.style.cursor = figEnabled ? 'pointer' : 'not-allowed';
            figBtn.style.display = 'flex';
        }

        // Bingo: solo cuando el modo es 'bingo'
        if (bingoBtn) {
            const bingoEnabled = currentGameMode === 'bingo';
            bingoBtn.disabled = !bingoEnabled;
            bingoBtn.style.opacity = bingoEnabled ? '1' : '0.4';
            bingoBtn.style.cursor = bingoEnabled ? 'pointer' : 'not-allowed';
        }
    } else {
        bar.classList.add('hidden');
    }

    if (window.lucide) window.lucide.createIcons();
}

document.getElementById('singLineBtn').addEventListener('click', () => {
    claimWin('Línea');
});

document.getElementById('singFigureBtn').addEventListener('click', () => {
    claimWin('Figura');
});

document.getElementById('singBingoBtn').addEventListener('click', () => {
    claimWin('Bingo');
});

function claimWin(claimType) {
    if (gamePaused) {
        showToast('Espera... se está verificando otro canto.', 'warning');
        return;
    }

    // Encontrar los cartones confirmados del jugador
    const myConfirmed = allCards.filter(c =>
        myCards.has(String(c.serial)) && myCardStatuses[c.serial] === 'confirmed'
    );

    if (myConfirmed.length === 0) {
        showToast('No tienes cartones para cantar.', 'warning');
        return;
    }

    // Validar que al menos un cartón tenga la jugada correcta
    const validCards = myConfirmed.filter(card => validateClaimOnCard(card, claimType));

    if (validCards.length === 0) {
        showToast(`❌ Ninguno de tus cartones tiene la jugada completa para cantar ${claimType}.`, 'warning');
        return;
    }

    // Enviar claim solo para los cartones que realmente tienen la jugada
    validCards.forEach(card => {
        if (socket) {
            socket.emit('player-claims-win', {
                playerName,
                cardSerial: card.serial,
                claimType
            });
        }
    });

    showToast(`🎤 ¡Has cantado ${claimType}! Esperando verificación del animador...`, 'success');
}

// ============================================================
// Claim Validation — Verify card content before claiming
// ============================================================
function validateClaimOnCard(card, claimType) {
    // Get the card element from the DOM to check marked cells
    const cardEl = document.querySelector(`.my-bingo-card[data-serial="${card.serial}"]`);
    if (!cardEl) return false;

    // Get marked cells as a 5x5 grid
    const grid = [];
    for (let row = 0; row < 5; row++) {
        grid[row] = [];
        for (let col = 0; col < 5; col++) {
            const cell = cardEl.querySelector(`.bingo-cell[data-row="${row}"][data-col="${col}"]`);
            if (!cell) {
                grid[row][col] = false;
                continue;
            }
            // Center cell (FREE) is always marked
            if (row === 2 && col === 2) {
                grid[row][col] = true;
            } else {
                grid[row][col] = cell.classList.contains('marked');
            }
        }
    }

    if (claimType === 'Línea') {
        // Check any complete row
        for (let row = 0; row < 5; row++) {
            if (grid[row].every(v => v)) return true;
        }
        return false;
    }

    if (claimType === 'Bingo') {
        // All cells must be marked
        for (let row = 0; row < 5; row++) {
            for (let col = 0; col < 5; col++) {
                if (!grid[row][col]) return false;
            }
        }
        return true;
    }

    if (claimType === 'Figura') {
        // Validate based on currentSelectedFigure
        return validateFigure(grid, currentSelectedFigure);
    }

    return false;
}

function validateFigure(grid, figure) {
    const patterns = {
        'X': [[0, 0], [0, 4], [1, 1], [1, 3], [2, 2], [3, 1], [3, 3], [4, 0], [4, 4]],
        'L': [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [4, 2], [4, 3], [4, 4]],
        'T': [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [2, 2], [3, 2], [4, 2]],
        'N': [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [1, 1], [2, 2], [3, 3], [0, 4], [1, 4], [2, 4], [3, 4], [4, 4]],
        'H': [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [2, 1], [2, 2], [2, 3], [0, 4], [1, 4], [2, 4], [3, 4], [4, 4]]
    };
    const cells = patterns[figure];
    if (!cells) return false;
    return cells.every(([row, col]) => grid[row][col]);
}

// ============================================================
// Prize Display
// ============================================================
function updatePrizeDisplay() {
    const el = document.getElementById('prizeDisplay');
    if (!el) return;
    if (salesLocked && totalPrize > 0) {
        el.textContent = `$${totalPrize.toFixed(2)}`;
        el.parentElement.classList.remove('hidden');
    } else {
        el.parentElement.classList.add('hidden');
    }
}

// ============================================================
// Claim Overlay (Game Paused)
// ============================================================
function showClaimOverlay(data) {
    let overlay = document.getElementById('claimOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'claimOverlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 300; background: rgba(0,0,0,0.75);
            backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center;
            animation: fadeIn 0.3s ease;
        `;
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
        <div style="text-align: center; max-width: 400px; padding: 32px;">
            <div style="width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, #f59e0b, #d97706);
                display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;
                box-shadow: 0 0 30px rgba(245,158,11,0.4); animation: pulse 1.5s infinite;">
                <span style="font-size: 2rem;">🎤</span>
            </div>
            <h2 style="color: white; font-size: 1.5rem; font-weight: 700; margin-bottom: 8px; font-family: 'Outfit', sans-serif;">
                ¡${data.playerName} cantó ${data.claimType}!
            </h2>
            <p style="color: #fbbf24; font-size: 1rem; margin-bottom: 8px;">Cartón #${data.cardSerial}</p>
            <p style="color: #9ca3af; font-size: 0.85rem;">Esperando verificación del animador...</p>
            <div style="margin-top: 16px;">
                <div style="width: 40px; height: 40px; border: 3px solid #fbbf24; border-top-color: transparent;
                    border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto;"></div>
            </div>
        </div>
    `;
}

function hideClaimOverlay() {
    const overlay = document.getElementById('claimOverlay');
    if (overlay) overlay.remove();
}

// ============================================================
// Init Lucide Icons
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) {
        window.lucide.createIcons();
    }
});

// ============================================================
// Player Game-Ended Modal
// ============================================================
function showPlayerGameEndedModal(data) {
    let overlay = document.getElementById('playerGameEndedOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'playerGameEndedOverlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 300; background: rgba(0,0,0,0.85);
            backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center;
            animation: fadeIn 0.3s ease; padding: 20px;
        `;
        document.body.appendChild(overlay);
    }

    const winners = data.winners || [];
    const isWinner = winners.some(w => {
        const serial = String(w.cardIndex || w.cardSerial || '');
        return myCards.has(serial);
    });

    let winnersHtml = winners.map(w => {
        let icon = '🏆', color = '#34d399';
        if (w.prizeType && w.prizeType.includes('Figura')) { icon = '⭐'; color = '#60a5fa'; }
        else if (w.prizeType && w.prizeType.includes('Línea')) { icon = '🏅'; color = '#fb923c'; }
        return `<div style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;">
            <span style="font-size: 1.2rem;">${icon}</span>
            <span style="color: white; font-weight: 700; font-size: 0.85rem;">#${w.cardIndex || w.cardSerial || '?'}</span>
            <span style="color: ${color}; font-weight: 700; font-size: 0.75rem; text-transform: uppercase;">${w.prizeType || '?'}</span>
        </div>`;
    }).join('');

    let winnerPaymentFormHtml = '';
    if (isWinner) {
        winnerPaymentFormHtml = `
            <div style="margin-top: 16px; background: linear-gradient(135deg, rgba(52,211,153,0.15), rgba(16,185,129,0.05));
                border: 1px solid rgba(52,211,153,0.3); border-radius: 12px; padding: 16px; text-align: left;">
                <h4 style="color: #34d399; font-weight: 700; font-size: 0.85rem; text-transform: uppercase; margin-bottom: 12px;
                    letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px;">
                    🎉 \u00a1Felicidades! Ingresa tus datos para el pago del premio
                </h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <input type="text" id="winnerDataName" placeholder="Tu nombre completo" style="width: 100%; padding: 8px 12px;
                        background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: white;
                        font-size: 0.8rem; outline: none;">
                    <input type="text" id="winnerDataCedula" placeholder="C\u00e9dula V-12345678" style="width: 100%; padding: 8px 12px;
                        background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: white;
                        font-size: 0.8rem; outline: none;">
                    <input type="text" id="winnerDataBank" placeholder="Banco receptor" style="width: 100%; padding: 8px 12px;
                        background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: white;
                        font-size: 0.8rem; outline: none;">
                    <input type="tel" id="winnerDataPhone" placeholder="Tel\u00e9fono 04XX..." style="width: 100%; padding: 8px 12px;
                        background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: white;
                        font-size: 0.8rem; outline: none;">
                </div>
                <button onclick="submitWinnerPaymentData()" style="width: 100%; margin-top: 10px; padding: 10px; border-radius: 10px;
                    background: linear-gradient(135deg, #059669, #10b981); color: white; font-weight: 700; border: none;
                    cursor: pointer; font-size: 0.85rem; transition: all 0.2s;">
                    ✅ Enviar Datos de Pago
                </button>
            </div>
        `;
    }

    overlay.innerHTML = `
        <div style="text-align: center; max-width: 450px; width: 100%; background: rgba(15,23,42,0.95);
            border: 1px solid rgba(234,179,8,0.4); border-radius: 16px; padding: 24px;
            box-shadow: 0 0 40px rgba(234,179,8,0.15);">
            <div style="width: 64px; height: 64px; border-radius: 50%; background: linear-gradient(135deg, #f59e0b, #d97706);
                display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;
                box-shadow: 0 0 25px rgba(245,158,11,0.4);">
                <span style="font-size: 1.8rem;">🏆</span>
            </div>
            <h2 style="color: white; font-size: 1.4rem; font-weight: 700; margin-bottom: 4px; font-family: 'Outfit', sans-serif;">
                \u00a1Partida Finalizada!
            </h2>
            <p style="color: #9ca3af; font-size: 0.8rem; margin-bottom: 16px;">Pote: $${(data.totalPrize || 0).toFixed(2)}</p>
            <div style="margin-bottom: 12px;">
                <h4 style="color: #fbbf24; font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;
                    margin-bottom: 8px;">Ganadores</h4>
                <div style="display: flex; flex-direction: column; gap: 6px; max-height: 150px; overflow-y: auto;">
                    ${winnersHtml || '<p style="color: #6b7280; font-size: 0.85rem; font-style: italic;">No hubo ganadores.</p>'}
                </div>
            </div>
            ${winnerPaymentFormHtml}
            <button onclick="document.getElementById('playerGameEndedOverlay').remove();"
                style="margin-top: 16px; padding: 10px 24px; border-radius: 10px; background: rgba(255,255,255,0.1);
                border: 1px solid rgba(255,255,255,0.2); color: white; font-weight: 600; cursor: pointer;
                font-size: 0.85rem; transition: all 0.2s; width: 100%;">
                Cerrar
            </button>
        </div>
    `;
}

function submitWinnerPaymentData() {
    const name = document.getElementById('winnerDataName')?.value.trim();
    const cedula = document.getElementById('winnerDataCedula')?.value.trim();
    const bank = document.getElementById('winnerDataBank')?.value.trim();
    const phone = document.getElementById('winnerDataPhone')?.value.trim();

    if (!name) {
        showToast('Por favor ingresa tu nombre.', 'warning');
        return;
    }

    if (socket) {
        socket.emit('winner-payment-data', {
            playerName,
            gameId: currentGameId,
            paymentData: { name, cedula, bank, phone }
        });
    }

    showToast('✅ Datos enviados. El animador te contactar\u00e1 para el pago.', 'success');
    const overlay = document.getElementById('playerGameEndedOverlay');
    if (overlay) overlay.remove();
}
