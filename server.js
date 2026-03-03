const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Ruta de la carpeta donde se guarda la partida
const savePath = path.join(__dirname, 'saved_games');
const saveFile = path.join(savePath, 'gameState.json');
const winnersFile = path.join(savePath, 'winners_history.json');
const cardHashesFile = path.join(savePath, 'card_hashes.json');
const winnerPaymentsFile = path.join(savePath, 'winner_payments.json');

if (!fs.existsSync(savePath)) {
    fs.mkdirSync(savePath);
}

// ============================================================
// Persistent data helpers
// ============================================================
function loadJSON(filePath, defaultValue) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error(`Error loading ${filePath}:`, e.message);
    }
    return defaultValue;
}

function saveJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`Error saving ${filePath}:`, e.message);
    }
}

// Persistent winners (survive game resets)
let allTimeWinners = loadJSON(winnersFile, []);
// Card hash history for uniqueness
let cardHashHistory = loadJSON(cardHashesFile, []);
// Winner payment records
let winnerPayments = loadJSON(winnerPaymentsFile, []);

function generateGameId() {
    return Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function hashCard(card) {
    // Simple hash: stringify the numbers object
    return JSON.stringify(card.numbers);
}

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'src')));

// ============================================================
// Estado en memoria
// ============================================================
let gameCards = [];
/**
 * purchasedCards[serial] = {
 *   buyer: string,
 *   status: 'reserved' | 'payment_sent' | 'confirmed',
 *   paymentData: { phone, bank, cedula } | null,
 *   reservedAt: ISO string,
 *   timerId: NodeJS.Timeout | null
 * }
 */
let purchasedCards = {};

const RESERVATION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos

// Datos de pago configurados por el animador
let paymentConfig = {
    bank: '',
    phone: '',
    cedula: ''
};

let gameState = {
    gameId: generateGameId(),
    calledNumbers: [],
    currentNumber: null,
    lastBalls: [],
    ballCount: 0,
    gameMode: 'figure',
    selectedFigure: 'X',
    cardPrice: 10,
    totalPrize: 0,
    winners: [],
    gameActive: false,
    gameStarted: false
};

// ============================================================
// Utilidades
// ============================================================
function getCardStatus(serial) {
    const p = purchasedCards[serial];
    if (!p) return 'available';
    return p.status;
}

function releaseCard(serial, reason) {
    const p = purchasedCards[serial];
    if (!p) return;
    if (p.timerId) clearTimeout(p.timerId);
    const buyer = p.buyer;
    delete purchasedCards[serial];
    recalcPrize();
    io.emit('card-released', { serial, buyer, reason });
    console.log(`[LIBERADO] Cartón #${serial} de "${buyer}" — ${reason}`);
}

function recalcPrize() {
    const confirmed = Object.values(purchasedCards).filter(p => p.status === 'confirmed').length;
    gameState.totalPrize = confirmed * gameState.cardPrice;
}

function startReservationTimer(serial) {
    const p = purchasedCards[serial];
    if (!p) return;
    if (p.timerId) clearTimeout(p.timerId);

    p.timerId = setTimeout(() => {
        const current = purchasedCards[serial];
        // Solo liberar si sigue en 'reserved' (NO si ya marcó pago)
        if (current && current.status === 'reserved') {
            releaseCard(serial, 'Tiempo de reserva expirado (10 min)');
        }
    }, RESERVATION_TIMEOUT_MS);
}

function getPublicCardList() {
    return gameCards.map(c => ({
        ...c,
        status: getCardStatus(c.serial),
        buyer: purchasedCards[c.serial]?.buyer || null,
        paymentData: purchasedCards[c.serial]?.paymentData || null,
        reservedAt: purchasedCards[c.serial]?.reservedAt || null
    }));
}

// ============================================================
// Rutas HTML
// ============================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'index.html'));
});

app.get('/player.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'player.html'));
});

// ============================================================
// API — Estado del juego
// ============================================================
app.get('/api/game-state', (req, res) => {
    res.json({
        ...gameState,
        totalCards: gameCards.length,
        availableCards: gameCards.filter(c => !purchasedCards[c.serial]).length,
        paymentConfig
    });
});

// ============================================================
// API — Configuración de datos de pago del animador
// ============================================================
app.get('/api/payment-config', (req, res) => {
    res.json(paymentConfig);
});

app.post('/api/payment-config', (req, res) => {
    const { bank, phone, cedula } = req.body;
    paymentConfig.bank = bank || '';
    paymentConfig.phone = phone || '';
    paymentConfig.cedula = cedula || '';

    // Notificar a todos los jugadores
    io.emit('payment-config-updated', paymentConfig);

    console.log(`[PAYMENT-CONFIG] Datos de pago actualizados: Banco=${paymentConfig.bank}, Tel=${paymentConfig.phone}, CI=${paymentConfig.cedula}`);
    res.json({ success: true, paymentConfig });
});

// ============================================================
// API — Cartones
// ============================================================

// Animador registra cartones generados
app.post('/api/cards/register', (req, res) => {
    const { cards, cardPrice } = req.body;
    if (!cards || !Array.isArray(cards)) {
        return res.status(400).json({ error: 'Se requiere un array de cartones.' });
    }

    // Limpiar timers anteriores
    Object.keys(purchasedCards).forEach(serial => {
        if (purchasedCards[serial].timerId) clearTimeout(purchasedCards[serial].timerId);
    });

    gameCards = cards;
    purchasedCards = {};
    gameState.cardPrice = cardPrice || 10;
    gameState.totalPrize = 0;
    gameState.gameActive = true;

    io.emit('cards-updated', {
        cards: getPublicCardList(),
        cardPrice: gameState.cardPrice
    });

    console.log(`[SERVER] ${cards.length} cartones registrados a $${gameState.cardPrice} c/u.`);
    res.json({ success: true, count: cards.length });
});

// Listar todos los cartones con estado
app.get('/api/cards', (req, res) => {
    res.json({
        cards: getPublicCardList(),
        cardPrice: gameState.cardPrice
    });
});

// Jugador reserva un cartón individual (mantener para compatibilidad)
app.post('/api/cards/:serial/buy', (req, res) => {
    // Bloquear compras si la partida ya comenzó
    if (gameState.gameStarted) {
        return res.status(403).json({ error: 'La partida ya comenzó. No se pueden comprar más cartones.' });
    }

    const serial = req.params.serial;
    const { playerName } = req.body;

    if (!playerName || playerName.trim() === '') {
        return res.status(400).json({ error: 'Se requiere un nombre de jugador.' });
    }

    const card = gameCards.find(c => String(c.serial) === String(serial));
    if (!card) {
        return res.status(404).json({ error: 'Cartón no encontrado.' });
    }

    if (purchasedCards[serial]) {
        return res.status(409).json({
            error: `Este cartón ya fue reservado por "${purchasedCards[serial].buyer}".`
        });
    }

    const now = new Date().toISOString();
    purchasedCards[serial] = {
        buyer: playerName.trim(),
        status: 'reserved',
        paymentData: null,
        reservedAt: now,
        timerId: null
    };

    startReservationTimer(serial);

    io.emit('card-purchased', {
        serial,
        buyer: playerName.trim(),
        status: 'reserved',
        reservedAt: now
    });

    console.log(`[RESERVA] Cartón #${serial} reservado por "${playerName.trim()}" — timer 10 min iniciado.`);
    res.json({ success: true, status: 'reserved', reservedAt: now });
});

// Jugador reserva MÚLTIPLES cartones (BATCH)
app.post('/api/cards/buy-batch', (req, res) => {
    // Bloquear compras si la partida ya comenzó
    if (gameState.gameStarted) {
        return res.status(403).json({ error: 'La partida ya comenzó. No se pueden comprar más cartones.' });
    }

    const { playerName, serials } = req.body;

    if (!playerName || playerName.trim() === '') {
        return res.status(400).json({ error: 'Se requiere un nombre de jugador.' });
    }
    if (!serials || !Array.isArray(serials) || serials.length === 0) {
        return res.status(400).json({ error: 'Se requiere al menos un cartón.' });
    }

    // Verificar disponibilidad de TODOS antes de reservar
    const conflicts = [];
    for (const serial of serials) {
        const card = gameCards.find(c => String(c.serial) === String(serial));
        if (!card) {
            conflicts.push({ serial, error: 'No encontrado' });
            continue;
        }
        if (purchasedCards[serial]) {
            conflicts.push({ serial, error: `Reservado por "${purchasedCards[serial].buyer}"` });
        }
    }

    if (conflicts.length > 0) {
        return res.status(409).json({
            error: 'Algunos cartones no están disponibles.',
            conflicts
        });
    }

    // Reservar todos atómicamente
    const now = new Date().toISOString();
    const reserved = [];
    for (const serial of serials) {
        purchasedCards[serial] = {
            buyer: playerName.trim(),
            status: 'reserved',
            paymentData: null,
            reservedAt: now,
            timerId: null
        };
        startReservationTimer(serial);
        reserved.push(serial);

        io.emit('card-purchased', {
            serial,
            buyer: playerName.trim(),
            status: 'reserved',
            reservedAt: now
        });
    }

    console.log(`[RESERVA BATCH] ${reserved.length} cartones reservados por "${playerName.trim()}": [${reserved.join(', ')}]`);
    res.json({ success: true, serials: reserved, reservedAt: now });
});

// Jugador envía pago para TODOS sus cartones reservados (BATCH)
app.post('/api/cards/submit-payment-batch', (req, res) => {
    const { playerName, serials, phone, bank, cedula } = req.body;

    if (!playerName || !serials || serials.length === 0) {
        return res.status(400).json({ error: 'Datos incompletos.' });
    }

    const paymentData = {
        phone: phone || '',
        bank: bank || '',
        cedula: cedula || ''
    };

    const updated = [];
    for (const serial of serials) {
        const p = purchasedCards[serial];
        if (!p || p.buyer !== playerName) continue;
        if (p.status === 'confirmed') continue;

        // Cancelar timer
        if (p.timerId) {
            clearTimeout(p.timerId);
            p.timerId = null;
        }

        p.status = 'payment_sent';
        p.paymentData = paymentData;
        updated.push(serial);

        io.emit('payment-submitted', {
            serial,
            buyer: p.buyer,
            paymentData
        });
    }

    console.log(`[PAGO BATCH] "${playerName}" envió pago para ${updated.length} cartones: [${updated.join(', ')}]`);
    res.json({ success: true, updated });
});

// Animador confirma pago batch (todos los cartones de un comprador)
app.post('/api/cards/confirm-batch', (req, res) => {
    const { buyer } = req.body;
    if (!buyer) return res.status(400).json({ error: 'Se requiere nombre del comprador.' });

    const confirmed = [];
    Object.entries(purchasedCards).forEach(([serial, p]) => {
        if (p.buyer === buyer && (p.status === 'payment_sent' || p.status === 'reserved')) {
            if (p.timerId) {
                clearTimeout(p.timerId);
                p.timerId = null;
            }
            p.status = 'confirmed';
            confirmed.push(serial);

            io.emit('payment-confirmed', {
                serial,
                buyer: p.buyer,
                totalPrize: gameState.totalPrize
            });
        }
    });

    recalcPrize();

    // Emitir totalPrize actualizado
    confirmed.forEach(serial => {
        io.emit('payment-confirmed', {
            serial,
            buyer,
            totalPrize: gameState.totalPrize
        });
    });

    console.log(`[CONFIRM BATCH] ${confirmed.length} cartones de "${buyer}" confirmados.`);
    res.json({ success: true, confirmed });
});

// Animador rechaza pago batch (todos los de un comprador)
app.post('/api/cards/reject-batch', (req, res) => {
    const { buyer } = req.body;
    if (!buyer) return res.status(400).json({ error: 'Se requiere nombre del comprador.' });

    const released = [];
    Object.entries(purchasedCards).forEach(([serial, p]) => {
        if (p.buyer === buyer && p.status !== 'confirmed') {
            released.push(serial);
        }
    });

    released.forEach(serial => releaseCard(serial, 'Pago rechazado por el animador'));

    console.log(`[REJECT BATCH] ${released.length} cartones de "${buyer}" liberados.`);
    res.json({ success: true, released });
});

// Jugador cancela batch
app.post('/api/cards/cancel-batch', (req, res) => {
    const { playerName, serials } = req.body;
    if (!playerName || !serials) {
        return res.status(400).json({ error: 'Datos incompletos.' });
    }

    const released = [];
    for (const serial of serials) {
        const p = purchasedCards[serial];
        if (!p || p.buyer !== playerName || p.status === 'confirmed') continue;
        releaseCard(serial, 'Cancelado por el jugador');
        released.push(serial);
    }

    res.json({ success: true, released });
});

// Jugador envía datos de pago (PASO 2)
app.post('/api/cards/:serial/submit-payment', (req, res) => {
    const serial = req.params.serial;
    const { playerName, phone, bank, cedula } = req.body;

    const p = purchasedCards[serial];
    if (!p) return res.status(404).json({ error: 'Cartón no encontrado o no reservado.' });
    if (p.buyer !== playerName) return res.status(403).json({ error: 'No eres el comprador de este cartón.' });
    if (p.status === 'confirmed') return res.status(400).json({ error: 'Este cartón ya está confirmado.' });

    // Cancelar timer (ya marcó pago, no se libera automáticamente)
    if (p.timerId) {
        clearTimeout(p.timerId);
        p.timerId = null;
    }

    p.status = 'payment_sent';
    p.paymentData = {
        phone: phone || '',
        bank: bank || '',
        cedula: cedula || ''
    };

    io.emit('payment-submitted', {
        serial,
        buyer: p.buyer,
        paymentData: p.paymentData
    });

    console.log(`[PAGO] Cartón #${serial} — "${p.buyer}" marcó pago. Tel: ${phone}, Banco: ${bank}, CI: ${cedula}`);
    res.json({ success: true, status: 'payment_sent' });
});

// Animador confirma pago (PASO 3)
app.post('/api/cards/:serial/confirm-payment', (req, res) => {
    const serial = req.params.serial;
    const p = purchasedCards[serial];

    if (!p) return res.status(404).json({ error: 'Cartón no encontrado o no reservado.' });

    if (p.timerId) {
        clearTimeout(p.timerId);
        p.timerId = null;
    }

    p.status = 'confirmed';
    recalcPrize();

    io.emit('payment-confirmed', {
        serial,
        buyer: p.buyer,
        totalPrize: gameState.totalPrize
    });

    console.log(`[CONFIRMADO] Cartón #${serial} — pago de "${p.buyer}" confirmado.`);
    res.json({ success: true, status: 'confirmed' });
});

// Animador rechaza pago
app.post('/api/cards/:serial/reject-payment', (req, res) => {
    const serial = req.params.serial;
    const p = purchasedCards[serial];

    if (!p) return res.status(404).json({ error: 'Cartón no encontrado.' });

    releaseCard(serial, 'Pago rechazado por el animador');
    res.json({ success: true, status: 'available' });
});

// Jugador cancela su reserva
app.post('/api/cards/:serial/cancel', (req, res) => {
    const serial = req.params.serial;
    const { playerName } = req.body;
    const p = purchasedCards[serial];

    if (!p) return res.status(404).json({ error: 'Cartón no encontrado.' });
    if (p.buyer !== playerName) return res.status(403).json({ error: 'No eres el comprador.' });
    if (p.status === 'confirmed') return res.status(400).json({ error: 'No puedes cancelar un cartón ya confirmado.' });

    releaseCard(serial, 'Cancelado por el jugador');
    res.json({ success: true, status: 'available' });
});

// Obtener cartones de un jugador específico
app.get('/api/cards/player/:name', (req, res) => {
    const name = decodeURIComponent(req.params.name).trim();
    const playerCards = gameCards.filter(card =>
        purchasedCards[card.serial]?.buyer === name
    ).map(card => ({
        ...card,
        status: getCardStatus(card.serial),
        paymentData: purchasedCards[card.serial]?.paymentData || null,
        reservedAt: purchasedCards[card.serial]?.reservedAt || null
    }));
    res.json({ cards: playerCards, calledNumbers: gameState.calledNumbers });
});

// Obtener lista de pagos pendientes (para el animador)
app.get('/api/payments/pending', (req, res) => {
    const pending = Object.entries(purchasedCards)
        .filter(([_, p]) => p.status === 'reserved' || p.status === 'payment_sent')
        .map(([serial, p]) => ({
            serial,
            buyer: p.buyer,
            status: p.status,
            paymentData: p.paymentData,
            reservedAt: p.reservedAt
        }));
    res.json({ pending });
});

// ============================================================
// API — Winners History & Payments
// ============================================================
app.get('/api/winners', (req, res) => {
    res.json({ winners: allTimeWinners });
});

app.get('/api/winners/payments', (req, res) => {
    res.json({ payments: winnerPayments });
});

app.post('/api/winners/payment', (req, res) => {
    const { gameId, cardSerial, mode, prize, amount, paymentData } = req.body;
    if (!gameId || !cardSerial || !mode) {
        return res.status(400).json({ error: 'Datos incompletos.' });
    }
    const record = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        gameId,
        cardSerial,
        mode,
        prize: prize || '',
        amount: amount || 0,
        paymentData: paymentData || {},
        createdAt: new Date().toISOString()
    };
    winnerPayments.push(record);
    saveJSON(winnerPaymentsFile, winnerPayments);
    console.log(`[WINNER-PAYMENT] Pago registrado para cartón #${cardSerial} (${mode}) — $${amount}`);
    res.json({ success: true, record });
});

// ============================================================
// API — Guardar/Cargar partida
// ============================================================
app.post('/save-game', (req, res) => {
    const state = req.body;
    fs.writeFile(saveFile, JSON.stringify(state, null, 2), (err) => {
        if (err) {
            console.error('Error al guardar el juego:', err);
            return res.status(500).send('Error al guardar el juego.');
        }
        res.send('Juego guardado exitosamente.');
    });
});

app.get('/load-game', (req, res) => {
    if (!fs.existsSync(saveFile)) {
        return res.status(404).send('No hay una partida guardada.');
    }
    fs.readFile(saveFile, 'utf8', (err, data) => {
        if (err) {
            console.error('Error al cargar la partida:', err);
            return res.status(500).send('Error al cargar la partida.');
        }
        try {
            const state = JSON.parse(data);
            res.json(state);
        } catch (parseErr) {
            console.error('Error al analizar el archivo de guardado:', parseErr);
            res.status(500).send('Error al cargar la partida.');
        }
    });
});

// ============================================================
// Socket.IO
// ============================================================
io.on('connection', (socket) => {
    console.log(`[SOCKET] Cliente conectado: ${socket.id}`);

    socket.emit('sync-state', {
        ...gameState,
        cards: getPublicCardList(),
        paymentConfig,
        allTimeWinners
    });

    // Animador genera bola
    socket.on('new-ball', (data) => {
        gameState.currentNumber = data.number;
        gameState.calledNumbers = data.calledNumbers;
        gameState.lastBalls = data.lastBalls;
        gameState.ballCount = data.ballCount;
        socket.broadcast.emit('new-ball', data);

        // === GAME-START LOCK: primera bola cierra las ventas ===
        if (!gameState.gameStarted) {
            gameState.gameStarted = true;
            console.log('[GAME-START] La partida ha comenzado. Cerrando ventas...');

            // Liberar cartones no confirmados (reserved o payment_sent)
            const releasedSerials = [];
            Object.entries(purchasedCards).forEach(([serial, p]) => {
                if (p.status !== 'confirmed') {
                    if (p.timerId) clearTimeout(p.timerId);
                    releasedSerials.push({ serial, buyer: p.buyer });
                    delete purchasedCards[serial];
                }
            });

            if (releasedSerials.length > 0) {
                console.log(`[GAME-START] ${releasedSerials.length} cartones no confirmados liberados: [${releasedSerials.map(r => '#' + r.serial).join(', ')}]`);
            }

            // Filtrar gameCards: solo quedan los que tienen comprador confirmado
            const beforeCount = gameCards.length;
            const confirmedSerials = new Set(Object.keys(purchasedCards));
            gameCards = gameCards.filter(c => confirmedSerials.has(String(c.serial)));
            const removedCount = beforeCount - gameCards.length;

            if (removedCount > 0) {
                console.log(`[GAME-START] ${removedCount} cartones sin vender eliminados del juego.`);
            }

            // Recalcular pote con los cartones que quedan
            recalcPrize();
            // Para el pote del animador: totalPrize = todos los cartones en juego × precio
            // (todos los que quedan están confirmados)
            gameState.totalPrize = gameCards.length * gameState.cardPrice;

            console.log(`[GAME-START] Cartones en juego: ${gameCards.length}, Pote recalculado: $${gameState.totalPrize}`);

            // Emitir evento game-started a todos los clientes
            io.emit('game-started', {
                cards: getPublicCardList(),
                totalPrize: gameState.totalPrize,
                gameMode: gameState.gameMode,
                selectedFigure: gameState.selectedFigure,
                gameId: gameState.gameId,
                soldCount: gameCards.length,
                removedCount: removedCount,
                releasedSerials: releasedSerials
            });
        }
    });

    // Animador registra cartones
    socket.on('cards-generated', (data) => {
        // Limpiar timers
        Object.keys(purchasedCards).forEach(serial => {
            if (purchasedCards[serial].timerId) clearTimeout(purchasedCards[serial].timerId);
        });

        // Check card uniqueness and track hashes
        if (data.cards && Array.isArray(data.cards)) {
            const newHashes = data.cards.map(c => hashCard(c));
            const duplicates = newHashes.filter(h => cardHashHistory.includes(h));
            if (duplicates.length > 0) {
                console.log(`[CARDS] ${duplicates.length} cartón(es) duplicado(s) detectados (se aceptan igualmente).`);
            }
            cardHashHistory.push(...newHashes);
            // Keep only last 10000 hashes to avoid unbounded growth
            if (cardHashHistory.length > 10000) {
                cardHashHistory = cardHashHistory.slice(-10000);
            }
            saveJSON(cardHashesFile, cardHashHistory);
        }

        gameCards = data.cards;
        purchasedCards = {};
        gameState.gameId = data.gameId || generateGameId();
        gameState.cardPrice = data.cardPrice;
        gameState.gameMode = data.gameMode;
        gameState.selectedFigure = data.selectedFigure;
        gameState.gameActive = true;
        gameState.gameStarted = false;
        gameState.calledNumbers = [];
        gameState.currentNumber = null;
        gameState.lastBalls = [];
        gameState.ballCount = 0;
        gameState.totalPrize = 0;
        gameState.winners = [];

        socket.broadcast.emit('cards-updated', {
            cards: getPublicCardList(),
            cardPrice: gameState.cardPrice,
            gameId: gameState.gameId
        });
    });

    // Animador anuncia ganador
    socket.on('winner-announced', (data) => {
        const winnerEntry = {
            ...data,
            gameId: gameState.gameId,
            timestamp: new Date().toISOString()
        };
        gameState.winners.push(winnerEntry);
        allTimeWinners.push(winnerEntry);
        saveJSON(winnersFile, allTimeWinners);
        gameState.gameMode = data.nextMode || gameState.gameMode;
        socket.broadcast.emit('winner-announced', winnerEntry);
    });

    // Jugador canta premio — pausar juego
    socket.on('player-claims-win', (data) => {
        console.log(`[CLAIM] Jugador "${data.playerName}" canta ${data.claimType} con cartón #${data.cardSerial}`);
        // Notificar a TODOS (incluido el que canta) que el juego está pausado
        io.emit('game-paused', {
            playerName: data.playerName,
            cardSerial: data.cardSerial,
            claimType: data.claimType
        });
    });

    // Animador verifica el claim (correcto o incorrecto)
    socket.on('claim-result', (data) => {
        console.log(`[CLAIM-RESULT] Cartón #${data.cardSerial}: ${data.valid ? 'VÁLIDO' : 'INVÁLIDO'}`);
        // Retransmitir resultado a todos
        io.emit('claim-result', data);

        // Si es Bingo válido, emitir game-ended
        if (data.valid && data.claimType === 'Bingo') {
            console.log(`[GAME-ENDED] Bingo válido. Partida ${gameState.gameId} terminada.`);
            io.emit('game-ended', {
                gameId: gameState.gameId,
                winners: gameState.winners,
                totalPrize: gameState.totalPrize,
                allTimeWinners
            });
        }
    });

    // Animador notifica receso
    socket.on('game-break', (data) => {
        console.log(`[BREAK] Receso de ${data.minutes} minutos.`);
        io.emit('game-break', { minutes: data.minutes });
    });

    // Animador resetea partida
    socket.on('game-reset', () => {
        Object.keys(purchasedCards).forEach(serial => {
            if (purchasedCards[serial].timerId) clearTimeout(purchasedCards[serial].timerId);
        });
        gameCards = [];
        purchasedCards = {};
        gameState = {
            gameId: generateGameId(),
            calledNumbers: [],
            currentNumber: null,
            lastBalls: [],
            ballCount: 0,
            gameMode: 'figure',
            selectedFigure: 'X',
            cardPrice: 10,
            totalPrize: 0,
            winners: [],
            gameActive: false,
            gameStarted: false
        };
        // NOTE: allTimeWinners is NOT cleared on reset
        socket.broadcast.emit('game-reset');
    });

    socket.on('disconnect', () => {
        console.log(`[SOCKET] Cliente desconectado: ${socket.id}`);
    });
});

// ============================================================
// Iniciar servidor
// ============================================================
server.listen(PORT, () => {
    console.log(`🎱 Bingo Pro Max — Servidor en http://localhost:${PORT}`);
    console.log(`   📺 Animador: http://localhost:${PORT}/`);
    console.log(`   🎮 Jugador:  http://localhost:${PORT}/player.html`);
});