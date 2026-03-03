// Variables globales
const socket = typeof io !== 'undefined' ? io() : null;
let calledNumbers = new Set();
const totalBalls = 75;
let currentNumber = null;
let isAnimating = false;
let gameMode = 'figure';
let winners = new Set();
let lastBalls = [];
let ballCount = 0;
let totalPrize = 0;
let selectedFigure = 'X';
let cardsGenerated = false;
let nextCardSerial = 1;
let messageTimeout = null;
let cardPrice = 10;
let currentGameId = '';
let allTimeWinnersCache = [];
//CODIGO NUEVO//CODIGO NUEVO//CODIGO NUEVO//CODIGO NUEVO//CODIGO NUEVO//CODIGO NUEVO

function getGameState() {
    return {
        calledNumbers: Array.from(calledNumbers),
        currentNumber,
        isAnimating,
        gameMode,
        winners: Array.from(winners),
        lastBalls,
        ballCount,
        cardPrice,
        totalPrize,
        selectedFigure,
        cardsGenerated,
        nextCardSerial,
        cards: Array.from(document.querySelectorAll('.bingo-card')).map(card => ({
            index: card.dataset.cardIndex,
            name: card.querySelector('.card-name-input').value,
            price: parseFloat(card.querySelector('.card-price-badge').textContent.replace('$', '')),
            numbers: Array.from(card.querySelectorAll('.bingo-cell')).map(cell => ({
                row: cell.dataset.row,
                col: cell.dataset.col,
                text: cell.textContent,
                marked: cell.classList.contains('marked')
            }))
        }))
    };
}

function autoSave() {
    const gameState = getGameState();
    // Guardado silencioso solo como backup en caso de cierre accidental
    try {
        localStorage.setItem('bingoGameState', JSON.stringify(gameState));
    } catch (e) {
        console.error('Error auto-saving to localStorage:', e);
    }

    if (window.location.protocol !== 'file:') {
        fetch('/save-game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(gameState)
        }).catch(err => console.error('Error auto-saving to server:', err));
    }
}

function exportGame() {
    const gameState = getGameState();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(gameState, null, 2));
    const downloadAnchorNode = document.createElement('a');

    const date = new Date();
    const dateString = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}_${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}`;

    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `Partida_Bingo_${dateString}.json`);
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();

    showMessage("Archivo de guardado descargado exitosamente.");
}

const applyGameState = (gameState) => {
    calledNumbers = new Set(gameState.calledNumbers);
    currentNumber = gameState.currentNumber;
    isAnimating = gameState.isAnimating;
    gameMode = gameState.gameMode;
    winners = new Set(gameState.winners);
    lastBalls = gameState.lastBalls || [];
    ballCount = gameState.ballCount || 0;
    cardPrice = gameState.cardPrice || 10;
    totalPrize = gameState.totalPrize || 0;
    selectedFigure = gameState.selectedFigure || 'X';
    cardsGenerated = gameState.cardsGenerated || false;
    nextCardSerial = gameState.nextCardSerial || 1;

    document.getElementById('countDisplay').textContent = ballCount;
    document.getElementById('randomNumber').textContent = currentNumber ? (getLetterForNumber(currentNumber) + currentNumber) : '?';
    updateLastBallsDisplay();

    const bingoCardsContainer = document.getElementById('bingoCards');
    bingoCardsContainer.innerHTML = ''; // Clear existing cards
    const emptyState = document.getElementById('emptyCardsState');
    if (emptyState) {
        emptyState.style.display = 'none'; // Ocultar state vacio
    }

    // Restaurar los cartones
    if (gameState.cards && gameState.cards.length > 0) {
        gameState.cards.forEach(cardData => {
            const card = createBingoCardElement({
                B: [], I: [], N: [], G: [], O: []
            }, cardData.index, cardData.price);

            card.querySelector('.card-name-input').value = cardData.name || '';
            cardData.numbers.forEach(numberData => {
                const cell = card.querySelector(`.bingo-cell[data-row="${numberData.row}"][data-col="${numberData.col}"]`);
                if (cell) {
                    cell.textContent = numberData.text;
                    if (numberData.marked) cell.classList.add('marked');
                }
            });
            bingoCardsContainer.appendChild(card);
        });
    }

    // Habilitar checkboxes de borrar tras cargar
    const figureModeCheckbox = document.getElementById('figureMode');
    if (cardsGenerated) {
        figureModeCheckbox.disabled = true;
        document.querySelectorAll('.delete-card-button').forEach(button => button.disabled = false);
        const delBtn = document.getElementById('deleteSelectedCardsButton');
        if (delBtn) delBtn.disabled = false;
    }

    recalculatePrizes();
};

function autoLoad() {
    // Si se ejecuta en modo local, leemos localStorage inmediatamente (Recovery mode)
    const localData = localStorage.getItem('bingoGameState');
    if (localData) {
        try {
            const gameState = JSON.parse(localData);
            applyGameState(gameState);
        } catch (e) {
            console.error("Error al leer guardado local autorecovery", e);
        }
    }
}

function showNewGameConfirm() {
    const overlay = document.getElementById('newGameConfirmOverlay');
    overlay.classList.remove('hidden');
    document.getElementById('newGameModalContent').classList.remove('scale-95');
    document.getElementById('newGameModalContent').classList.add('scale-100');
}

function executeNewGame() {
    // 1. Destruir el "guardado de emergencia" que revivía los cartones fantasma
    localStorage.removeItem('bingoGameState');

    // 2. Destruir físicamente por seguridad antes de recargar
    document.querySelectorAll('.bingo-card').forEach(card => card.remove());
    document.getElementById('bingoCards').innerHTML = '';

    // 3. Notificar a los participantes del reset
    if (socket) socket.emit('game-reset');

    // 4. Forzar el refrescamiento absoluto del navegador para limpiar la memoria JS
    window.location.reload(true);
}

//CODIGO NUEVO//CODIGO NUEVO//CODIGO NUEVO//CODIGO NUEVO//CODIGO NUEVO//CODIGO NUEVO

// Eliminar listeners obsoletos que crasheaban el script

//CODIGO NUEVO//CODIGO NUEVO//CODIGO NUEVO//CODIGO NUEVO//CODIGO NUEVO//CODIGO NUEVO

// Sonidos
const spinSound = new Audio('spin-sound.mp3');
const winnerSound = new Audio('winner-sound.mp3');

// Inicializar la cuadrícula de bolas
function initializeBallsGrid() {
    const grid = document.getElementById('ballsGrid');
    if (!grid) return; // Si no existe en el DOM, no inicializar

    for (let i = 1; i <= totalBalls; i++) {
        const ball = document.createElement('div');
        ball.className = 'ball';
        ball.id = `ball-${i}`;
        ball.textContent = i;
        grid.appendChild(ball);
    }
}

// Generar número aleatorio
function generateRandomNumber() {
    if (calledNumbers.size < totalBalls && !isAnimating) {
        if (!cardsGenerated && document.getElementById('bingoCards').children.length === 0) {
            showMessage("¡Por favor, genera cartones antes de jugar!");
            return;
        }

        isAnimating = true;
        const button = document.getElementById('generateNumber');
        const playIcon = document.getElementById('playIcon');
        const spinnerIcon = document.getElementById('spinnerIcon');
        const spinner = document.getElementById('randomNumber'); // Assuming randomNumber is the spinner

        playIcon.classList.add('hidden');
        spinnerIcon.classList.remove('hidden');
        spinnerIcon.classList.add('animate-spin');

        button.classList.add('cursor-not-allowed', 'opacity-50');
        button.setAttribute('disabled', 'true');

        spinSound.play();

        let animationCounter = 0;

        // Predeterminar el numero real inmediatamente
        let targetRandomNum;
        do {
            targetRandomNum = Math.floor(Math.random() * totalBalls) + 1;
        } while (calledNumbers.has(targetRandomNum));

        const animationInterval = setInterval(() => {
            let visualRandomNum = Math.floor(Math.random() * totalBalls) + 1;
            spinner.textContent = getLetterForNumber(visualRandomNum) + visualRandomNum;
            animationCounter++;
        }, 100);

        setTimeout(() => {
            clearInterval(animationInterval);

            spinSound.pause(); // Detener el sonido de giro
            spinSound.currentTime = 0; // Reiniciar el sonido de giro al principio

            playIcon.classList.remove('hidden');
            spinnerIcon.classList.add('hidden');
            spinnerIcon.classList.remove('animate-spin');
            button.classList.remove('cursor-not-allowed', 'opacity-50');
            button.removeAttribute('disabled');

            finalizeNumberGeneration(targetRandomNum);
        }, 1500); // 1.5 segundos de animación
    }

    // Deshabilitar el checkbox de activación del modo figura
    document.getElementById('figureMode').disabled = true;

    // Deshabilitar los botones de eliminación de cartones
    document.querySelectorAll('.delete-card-button').forEach(button => {
        button.disabled = true;
    });
    document.getElementById('deleteSelectedCardsButton').disabled = true;
}

// Obtener la letra correspondiente al número
function getLetterForNumber(number) {
    if (number >= 1 && number <= 15) return 'B';
    if (number >= 16 && number <= 30) return 'I';
    if (number >= 31 && number <= 45) return 'N';
    if (number >= 46 && number <= 60) return 'G';
    if (number >= 61 && number <= 75) return 'O';
    return '';
}

// Finalizar la generación del número
function finalizeNumberGeneration(number) {
    const numberElement = document.getElementById('randomNumber');
    numberElement.textContent = getLetterForNumber(number) + number;

    // Reiniciar y activar la animacion
    numberElement.classList.remove('animate-[popIn_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)_forwards]');
    void numberElement.offsetWidth; // trigger reflow
    numberElement.classList.add('animate-[popIn_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)_forwards]');

    currentNumber = number;
    calledNumbers.add(number);
    ballCount++;
    document.getElementById('countDisplay').textContent = ballCount;

    lastBalls.push(number);
    if (lastBalls.length > 10) lastBalls.shift();
    updateLastBallsDisplay();

    const ballsGrid = document.getElementById('ballsGrid');
    if (ballsGrid) {
        const ballElement = ballsGrid.children[number - 1]; // -1 porque las bolas empiezan desde 1
        if (ballElement) {
            ballElement.classList.add('called');
        }
    }

    isAnimating = false; // Permitir generar otro número
    markNumberInCards(number);

    // Emitir la bola a los participantes via Socket.IO
    if (socket) {
        socket.emit('new-ball', {
            number: number,
            calledNumbers: Array.from(calledNumbers),
            lastBalls: lastBalls,
            ballCount: ballCount
        });
    }

    checkWinners(); // Verificar si alguien ganó después de marcar el número
    autoSave(); // Autoguardado silencioso despues de cada balota
}

// Actualizar el registro de las últimas bolas
function updateLastBallsDisplay() {
    const lastBallsList = document.getElementById('lastBallsList');
    lastBallsList.innerHTML = '';
    if (lastBalls.length === 0) {
        lastBallsList.innerHTML = '<span class="text-gray-500 text-sm italic">Esperando bolas...</span>';
        return;
    }
    lastBalls.forEach(ball => {
        const ballDiv = document.createElement('div');
        ballDiv.className = 'ball';
        ballDiv.textContent = ball;
        lastBallsList.appendChild(ballDiv);
    });
}

class BingoNumberPool {
    constructor() {
        this.pools = {
            B: this.createShuffledPool(1, 15),
            I: this.createShuffledPool(16, 30),
            N: this.createShuffledPool(31, 45),
            G: this.createShuffledPool(46, 60),
            O: this.createShuffledPool(61, 75)
        };
    }

    createShuffledPool(min, max) {
        const pool = [];
        for (let i = min; i <= max; i++) pool.push(i);
        return this.shuffle(pool);
    }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    getNumbers(letter, count) {
        const min = letter === 'B' ? 1 : letter === 'I' ? 16 : letter === 'N' ? 31 : letter === 'G' ? 46 : 61;
        const max = min + 14;
        const result = [];

        while (result.length < count) {
            if (this.pools[letter].length === 0) {
                this.pools[letter] = this.createShuffledPool(min, max);
                this.pools[letter] = this.pools[letter].filter(n => !result.includes(n));
            }
            result.push(this.pools[letter].pop());
        }
        return result;
    }
}

let numberPool = new BingoNumberPool();

// Generar cartón de bingo
function generateBingoCard() {
    const card = {
        B: numberPool.getNumbers('B', 5),
        I: numberPool.getNumbers('I', 5),
        N: numberPool.getNumbers('N', 5),
        G: numberPool.getNumbers('G', 5),
        O: numberPool.getNumbers('O', 5)
    };
    card.N[2] = 'FREE';
    return card;
}

// Crear elemento visual del cartón
function createBingoCardElement(card, serial, price = 10) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'bingo-card';
    cardDiv.dataset.cardIndex = serial;

    let cardGridHtml = '';
    for (let row = 0; row < 5; row++) {
        'BINGO'.split('').forEach((letter, col) => {
            const number = card[letter][row];
            const isFree = number === 'FREE';
            const markedClass = isFree ? 'free marked' : '';
            cardGridHtml += `<div class="bingo-cell ${markedClass}" data-row="${row}" data-col="${col}">${isFree ? 'FREE' : number}</div>`;
        });
    }

    cardDiv.innerHTML = `
        <div class="card-header-bg"></div>
        <div class="card-price-badge">$${price}</div>
        <input type="text" class="card-name-input card-name" value="" placeholder="Nombre del jugador">
        <div class="bingo-header">
            <div>B</div><div>I</div><div>N</div><div>G</div><div>O</div>
        </div>
        <div class="bingo-grid">${cardGridHtml}</div>
        <div class="card-footer">
            <div class="card-serial">Serial: ${serial}</div>
            <div class="card-actions">
                <input type="checkbox" class="select-card-checkbox">
                <button class="delete-card-button">Eliminar</button>
            </div>
        </div>
    `;

    // Add event listeners for the dynamically created elements
    const nameInput = cardDiv.querySelector('.card-name-input');
    nameInput.addEventListener('change', () => {
        autoSave();
    });

    const deleteButton = cardDiv.querySelector('.delete-card-button');
    deleteButton.addEventListener('click', () => {
        cardDiv.remove();
        recalculatePrizes();
        autoSave();
    });

    return cardDiv;
}

function deleteSelectedCards() {
    const selectedCheckboxes = document.querySelectorAll('.select-card-checkbox:checked');
    selectedCheckboxes.forEach(checkbox => {
        checkbox.closest('.bingo-card').remove();
    });
    recalculatePrizes();
    autoSave(); // Autoguardado logico
}

function recalculatePrizes() {
    const cardCount = document.querySelectorAll('.bingo-card').length;
    totalPrize = cardCount * cardPrice;

    // Al ser un diseño premium lo mostramos en el header de arriba "prizeDetails" con el total de dinero.
    document.getElementById('prizeDetails').textContent = `$${totalPrize.toFixed(2)}`;

    // Calcular desgloses
    const isFigureMode = document.getElementById('figureMode') && document.getElementById('figureMode').checked;
    let pozoMayor = 0;
    let pozoFigura = 0;
    let pozoMenor = 0;

    const rowFigura = document.getElementById('prizeFiguraRow');
    if (isFigureMode) {
        pozoMayor = totalPrize * 0.50; // 50% para bingo lleno
        pozoFigura = totalPrize * 0.10; // 10% para figura
        pozoMenor = totalPrize * 0.20; // 20% para linea
        if (rowFigura) rowFigura.style.display = 'flex';
    } else {
        pozoMayor = totalPrize * 0.50; // 50% para bingo lleno
        pozoMenor = totalPrize * 0.30; // 30% para linea
        if (rowFigura) rowFigura.style.display = 'none';
        pozoFigura = 0;
    }

    document.getElementById('prizeMayor').textContent = `$${pozoMayor.toFixed(2)}`;
    if (isFigureMode && document.getElementById('prizeFigura')) document.getElementById('prizeFigura').textContent = `$${pozoFigura.toFixed(2)}`;
    document.getElementById('prizeMenor').textContent = `$${pozoMenor.toFixed(2)}`;
}

// Generar cartones
function generateCards() {
    const container = document.getElementById('bingoCards');
    container.innerHTML = '';

    // Ocultar el estado vacío
    const emptyState = document.getElementById('emptyCardsState');
    if (emptyState) emptyState.style.display = 'none';

    const input = document.getElementById('cardCount');
    const cardCount = Math.min(Math.max(parseInt(input.value) || 4, 1), 600);
    const priceInput = document.getElementById('cardPrice');
    cardPrice = parseInt(priceInput.value) || 10;
    const figureInput = document.getElementById('figure');
    selectedFigure = figureInput.value;
    calledNumbers.clear();
    // winners.clear(); // PROTECCION AL HISTORIAL DE GANADORES INTERPARTIDAS
    const figureModeCheckbox = document.getElementById('figureMode');
    gameMode = figureModeCheckbox.checked ? 'figure' : 'line';

    // Generate unique game ID
    currentGameId = Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    document.getElementById('gameMode').innerHTML = `${figureModeCheckbox.checked ? 'Modo: Figura' : 'Modo: Línea'} <span class="text-gray-500 text-[10px] ml-2">ID: ${currentGameId}</span>`;

    document.getElementById('randomNumber').textContent = '?';
    document.querySelectorAll('.ball').forEach(ball => ball.classList.remove('called'));

    numberPool = new BingoNumberPool();
    totalPrize = cardCount * cardPrice; // Calcular el premio total
    for (let i = 0; i < cardCount; i++) {
        const card = generateBingoCard();
        const serial = nextCardSerial++;
        const cardElement = createBingoCardElement(card, serial, cardPrice);
        container.appendChild(cardElement);
    }

    cardsGenerated = true; // Marcar que los cartones han sido generados
    recalculatePrizes();

    // Deshabilitar el checkbox de activación del modo figura
    figureModeCheckbox.disabled = true;

    // Habilitar los botones de eliminación de cartones
    document.querySelectorAll('.delete-card-button').forEach(button => {
        button.disabled = false;
    });
    document.getElementById('deleteSelectedCardsButton').disabled = false;

    autoSave(); // Autoguardado al crear cartones

    // Registrar cartones en el servidor para la vista de participantes
    if (socket) {
        const cardsData = Array.from(container.querySelectorAll('.bingo-card')).map(card => {
            const cells = card.querySelectorAll('.bingo-cell');
            const numbers = {};
            'BINGO'.split('').forEach((letter, colIdx) => {
                numbers[letter] = [];
                for (let row = 0; row < 5; row++) {
                    const cell = card.querySelector(`.bingo-cell[data-row="${row}"][data-col="${colIdx}"]`);
                    numbers[letter].push(cell ? cell.textContent : '');
                }
            });
            return {
                serial: card.dataset.cardIndex,
                numbers: numbers,
                price: cardPrice
            };
        });

        socket.emit('cards-generated', {
            cards: cardsData,
            cardPrice: cardPrice,
            gameMode: gameMode,
            selectedFigure: selectedFigure,
            gameId: currentGameId
        });

        // También registrar via API REST como backup
        fetch('/api/cards/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cards: cardsData, cardPrice: cardPrice })
        }).catch(err => console.error('Error registrando cartones:', err));
    }
}

// Marcar número en los cartones
function markNumberInCards(number) {
    const cards = document.querySelectorAll('.bingo-card');
    cards.forEach(card => {
        const cells = card.querySelectorAll('.bingo-cell');
        cells.forEach(cell => {
            if (cell.textContent === number.toString()) {
                cell.classList.add('marked');
            }
        });
    });
}

// Preguntar si alguien cantó figura, línea o bingo
function askForWinner(message, cardElement) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('winnerQuestionOverlay');
        const overlayText = document.getElementById('winnerQuestionText');
        const winnerCardImage = document.getElementById('winnerCardImage');
        const yesButton = document.getElementById('winnerYes');
        const noButton = document.getElementById('winnerNo');

        overlayText.textContent = message;

        // Limpiar estilos en linea antes de capturar el cartón para evitar que queden difuminados en la imagen
        // Solo quitamos la seleccion por un momento
        const wasSelected = cardElement.classList.contains('selected');
        if (wasSelected) cardElement.classList.remove('selected');

        // Capturar la imagen del cartón ganador usando html2canvas
        html2canvas(cardElement, {
            backgroundColor: '#0f172a', // Fondo igual al body
            scale: 2 // Mejorar la calidad
        }).then(canvas => {
            winnerCardImage.src = canvas.toDataURL('image/png');
            overlay.classList.remove('hidden');
            document.getElementById('winnerModalContent').classList.add('scale-100');
            document.getElementById('winnerModalContent').classList.remove('scale-95');

            if (wasSelected) cardElement.classList.add('selected'); // Restaurar

            // Auto-descargar la imagen del cartón ganador
            const link = document.createElement('a');
            link.download = `Ganador-${message.split('!')[0].replace('¡', '')}-Carton-${cardElement.dataset.cardIndex}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();

            yesButton.onclick = () => {
                overlay.classList.add('hidden');
                document.getElementById('winnerModalContent').classList.remove('scale-100');
                document.getElementById('winnerModalContent').classList.add('scale-95');
                resolve(true); // El ganador es válido
            };

            noButton.onclick = () => {
                overlay.classList.add('hidden');
                document.getElementById('winnerModalContent').classList.remove('scale-100');
                document.getElementById('winnerModalContent').classList.add('scale-95');
                resolve(false); // Falsa alarma
            };
        });
    });
}
// Reiniciar las marcas de los cartones y las bolas generadas
function resetMarksAndBalls() {
    calledNumbers.clear();
    ballCount = 0;
    lastBalls = [];
    document.getElementById('countDisplay').textContent = ballCount;
    document.getElementById('randomNumber').textContent = '?';
    document.querySelectorAll('.ball').forEach(ball => ball.classList.remove('called'));
    updateLastBallsDisplay();
}

// Verificar ganadores
async function checkWinners() {
    const cards = document.querySelectorAll('.bingo-card');
    let newWinners = [];
    cards.forEach(card => {
        const cardIndex = card.dataset.cardIndex;
        if (gameMode === 'figure' && checkFigure(card, selectedFigure)) {
            if (!winners.has(`${cardIndex}-figure`)) {
                winners.add(`${cardIndex}-figure`);
                card.style.border = '4px solid gold';
                const markedNumbers = getMarkedNumbers(card, 'figure');
                newWinners.push({ message: `¡Figura ${selectedFigure}! Cartón serial #${cardIndex} ha ganado!`, cardIndex, prizeType: `Figura ${selectedFigure}`, markedNumbers, cardElement: card });
                addWinningLabel(card, `Figura ${selectedFigure}`);
            }
        } else if (gameMode === 'line' && checkLine(card)) {
            if (!winners.has(`${cardIndex}-line`)) {
                winners.add(`${cardIndex}-line`);
                card.style.border = '4px solid gold';
                const markedNumbers = getMarkedNumbers(card, 'line');
                newWinners.push({ message: `¡Línea! Cartón serial #${cardIndex} ha ganado!`, cardIndex, prizeType: 'Línea', markedNumbers, cardElement: card });
                addWinningLabel(card, 'Línea');
            }
        } else if (gameMode === 'bingo' && checkFullCard(card)) {
            if (!winners.has(`${cardIndex}-bingo`)) {
                winners.add(`${cardIndex}-bingo`);
                card.style.border = '4px solid gold';
                const markedNumbers = getMarkedNumbers(card, 'bingo');
                newWinners.push({ message: `¡Bingo! Cartón serial #${cardIndex} ha ganado!`, cardIndex, prizeType: 'Bingo', markedNumbers, cardElement: card });
                addWinningLabel(card, 'Bingo');
            }
        }
    });

    if (newWinners.length > 0) {
        winnerSound.play();
        showMessage(newWinners.map(winner => winner.message).join('\n'));

        let anyWinnerSang = false;
        for (const winner of newWinners) {
            const response = await askForWinner(`¿Alguien cantó ${winner.prizeType} para el cartón serial #${winner.cardIndex}?`, winner.cardElement);
            if (response) {
                updateWinnersLog(winner.cardIndex, winner.prizeType, winner.markedNumbers);
                anyWinnerSang = true;
            } else {
                updateWinnersLog(winner.cardIndex, `${winner.prizeType} (No cantado)`, winner.markedNumbers);
            }
        }

        if (anyWinnerSang) {
            let nextMode = gameMode;
            if (gameMode === 'figure') {
                showNewGameConfirm();
                nextMode = 'line';
                gameMode = 'line';
                document.getElementById('gameMode').textContent = 'Modo: Línea';
            } else if (gameMode === 'line') {
                nextMode = 'bingo';
                gameMode = 'bingo';
                document.getElementById('gameMode').textContent = 'Modo: Bingo';
            }

            // Notificar ganador a los participantes
            if (socket) {
                for (const winner of newWinners) {
                    socket.emit('winner-announced', {
                        cardIndex: winner.cardIndex,
                        prizeType: winner.prizeType,
                        nextMode: nextMode
                    });
                }
            }
        }
    }
}

// Mostrar mensaje en el contenedor
function showMessage(message) {
    const messageBox = document.getElementById('messageBox');
    const messageText = document.getElementById('messageText');
    messageText.textContent = message;

    // Reset classes
    messageBox.style.opacity = '1';
    messageBox.style.transition = 'none';
    messageBox.classList.remove('hidden');

    if (messageTimeout) clearTimeout(messageTimeout);

    // Set timeout to fade out
    messageTimeout = setTimeout(() => {
        messageBox.style.transition = 'opacity 0.5s ease-out';
        messageBox.style.opacity = '0';

        setTimeout(() => {
            messageBox.classList.add('hidden');
        }, 500); // Wait for transition to end before hiding completely
    }, 3000);
}

// Cerrar el contenedor de mensajes
document.getElementById('closeMessageBox').addEventListener('click', () => {
    const messageBox = document.getElementById('messageBox');
    messageBox.classList.add('hidden');
});

// Obtener los números marcados en un cartón
function getMarkedNumbers(card, prizeType) {
    const markedCells = card.querySelectorAll('.bingo-cell.marked');
    if (prizeType === 'figure') {
        return Array.from(markedCells).map(cell => cell.textContent);
    } else if (prizeType === 'line') {
        const winningLine = getWinningLine(card);
        return winningLine.map(cell => cell.textContent);
    } else if (prizeType === 'bingo') {
        return Array.from(markedCells).map(cell => cell.textContent);
    }
    return [];
}

// Obtener la línea ganadora
function getWinningLine(card) {
    const rows = [0, 1, 2, 3, 4];
    const cols = [0, 1, 2, 3, 4];
    for (let row of rows) {
        const cells = card.querySelectorAll(`.bingo-cell[data-row="${row}"]`);
        if (Array.from(cells).every(cell => cell.classList.contains('marked') || cell.classList.contains('free'))) {
            return Array.from(cells);
        }
    }
    for (let col of cols) {
        const cells = card.querySelectorAll(`.bingo-cell[data-col="${col}"]`);
        if (Array.from(cells).every(cell => cell.classList.contains('marked') || cell.classList.contains('free'))) {
            return Array.from(cells);
        }
    }
    return [];
}

// (Second resetGame definition removed)

// Verificar si hay figura completa en un cartón
function checkFigure(card, figure) {
    const cells = card.querySelectorAll('.bingo-cell');
    const markedCells = Array.from(cells).filter(cell => cell.classList.contains('marked') || cell.classList.contains('free'));
    switch (figure) {
        case 'X':
            return checkX(markedCells);
        case 'L':
            return checkL(markedCells);
        case 'N':
            return checkN(markedCells);
        case 'T':
            return checkT(markedCells);
        case 'H':
            return checkH(markedCells);
        default:
            return false;
    }
}

// Funciones para verificar cada figura
function checkX(markedCells) {
    const xPattern = [
        [0, 0], [1, 1], [2, 2], [3, 3], [4, 4],
        [0, 4], [1, 3], [3, 1], [4, 0]
    ];
    return xPattern.every(([row, col]) => markedCells.some(cell => cell.dataset.row == row && cell.dataset.col == col));
}

function checkL(markedCells) {
    const lPattern = [
        [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
        [4, 1], [4, 2], [4, 3], [4, 4]
    ];
    return lPattern.every(([row, col]) => markedCells.some(cell => cell.dataset.row == row && cell.dataset.col == col));
}

function checkN(markedCells) {
    const nPattern = [
        [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
        [1, 1], [2, 2], [3, 3], [4, 4], [3, 4], [2, 4], [1, 4], [0, 4]
    ];
    return nPattern.every(([row, col]) => markedCells.some(cell => cell.dataset.row == row && cell.dataset.col == col));
}

function checkT(markedCells) {
    const tPattern = [
        [0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
        [1, 2], [2, 2], [3, 2], [4, 2]
    ];
    return tPattern.every(([row, col]) => markedCells.some(cell => cell.dataset.row == row && cell.dataset.col == col));
}

function checkH(markedCells) {
    const hPattern = [
        [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
        [2, 1], [2, 2], [2, 3], [2, 4],
        [0, 4], [1, 4], [3, 4], [4, 4]
    ];
    return hPattern.every(([row, col]) => markedCells.some(cell => cell.dataset.row == row && cell.dataset.col == col));
}

// Añadir etiqueta de ganador al cartón
function addWinningLabel(card, prizeType) {
    if (!card.querySelector(`.${prizeType}-label`)) { // Prevenir etiquetas duplicadas del mismo tipo
        const label = document.createElement('div');
        label.className = `winner-badge ${prizeType}-label`;
        label.textContent = prizeType.charAt(0).toUpperCase() + prizeType.slice(1);
        card.appendChild(label);
    }
}
// Actualizar el registro de ganadores
function updateWinnersLog(cardIndex, prizeType, markedNumbers) {
    const winnersLog = document.getElementById('winnersList');

    // Remover el mensaje inicial si existe
    const emptyMessage = winnersLog.querySelector('.italic');
    if (emptyMessage) emptyMessage.remove();

    let icon = 'award';
    let colorClass = 'text-emerald-400';
    let bgClass = 'bg-gradient-to-r from-emerald-500/20 to-emerald-500/5 border-emerald-500/40 text-emerald-400';

    if (prizeType.includes('Figura')) {
        icon = 'star';
        colorClass = 'text-blue-400';
        bgClass = 'bg-gradient-to-r from-blue-500/20 to-blue-500/5 border-blue-500/40 text-blue-400';
    } else if (prizeType.includes('Línea')) {
        icon = 'medal';
        colorClass = 'text-orange-400';
        bgClass = 'bg-gradient-to-r from-orange-500/20 to-orange-500/5 border-orange-500/40 text-orange-400';
    }

    if (prizeType.includes('No cantado')) {
        colorClass = 'text-red-400';
        bgClass = 'bg-gradient-to-r from-red-500/20 to-red-500/5 border-red-500/40 text-red-400';
        icon = 'x-circle';
    }

    const logEntry = document.createElement('li');
    logEntry.className = `p-2 rounded-xl border ${bgClass} mb-2 shadow-[0_4px_10px_rgba(0,0,0,0.15)] animate-[slide-down_0.3s_ease-out] relative overflow-hidden`;
    logEntry.innerHTML = `
        <div class="absolute top-0 right-0 w-10 h-10 bg-white/5 rounded-bl-[60px] -z-10"></div>
        <div class="flex items-center justify-between mb-1.5 flex-nowrap gap-1">
            <div class="flex items-center gap-1.5 flex-shrink-0">
                <div class="p-1 rounded shadow-sm bg-black/20 backdrop-blur-sm border border-white/10 flex-shrink-0">
                    <i data-lucide="${icon}" class="w-3.5 h-3.5 ${colorClass}"></i>
                </div>
                <span class="font-bold text-white tracking-wide text-xs truncate max-w-[90px]" title="Cartón #${cardIndex}">#${cardIndex}</span>
            </div>
            <span class="text-[8.5px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 bg-black/30 border border-white/10 ${colorClass} uppercase tracking-widest shadow-inner whitespace-nowrap">
                ${prizeType}
            </span>
        </div>
        <div class="text-[10px] pl-1 bg-black/10 p-1 rounded-md border border-white/5 flex flex-col gap-0.5">
            <span class="text-gray-400 font-medium text-[9px] uppercase tracking-wider">Números:</span> 
            <span class="text-white font-mono tracking-wider break-words leading-tight">${markedNumbers.join(', ')}</span>
        </div>
    `;

    winnersLog.prepend(logEntry);

    // Refresh lucide icons for newly added elements
    if (window.lucide) window.lucide.createIcons();
}

// Verificar si hay línea completa en un cartón
function checkLine(card) {
    const rows = [0, 1, 2, 3, 4];
    const cols = [0, 1, 2, 3, 4];
    return rows.some(row => {
        const cells = card.querySelectorAll(`.bingo-cell[data-row="${row}"]`);
        return Array.from(cells).every(cell => cell.classList.contains('marked') || cell.classList.contains('free'));
    }) || cols.some(col => {
        const cells = card.querySelectorAll(`.bingo-cell[data-col="${col}"]`);
        return Array.from(cells).every(cell => cell.classList.contains('marked') || cell.classList.contains('free'));
    });
}

// Verificar si hay cartón completo
function checkFullCard(card) {
    const cells = card.querySelectorAll('.bingo-cell');
    return Array.from(cells).every(cell => cell.classList.contains('marked') || cell.classList.contains('free'));
}

// Mostrar/Ocultar recuadro de premiaciones
document.getElementById('togglePrizeBox').addEventListener('click', () => {
    const dropdown = document.getElementById('prizeDropdown');
    dropdown.classList.toggle('hidden');
});

// Exportar cartones a PDF
document.getElementById('exportPdfButton').addEventListener('click', async () => {
    const { jsPDF } = window.jspdf;
    const cards = document.querySelectorAll('.bingo-card');
    const cardsPerPage = 6;
    const margin = 10;
    const pageWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const cardWidth = (pageWidth - 4 * margin) / 3; // Adjust card width to fit 3 cards per row
    const cardHeight = (pageHeight - 12 * margin) / 2; // Adjust card height to fit 2 rows per page
    const maxCardsPerPdf = 60; // Limit to 10 pages per PDF

    let pdfCount = 1;
    let doc = new jsPDF();

    for (let i = 0; i < cards.length; i++) {
        if (i > 0 && i % maxCardsPerPdf === 0) {
            const startCard = (pdfCount - 1) * maxCardsPerPdf + 1;
            const endCard = pdfCount * maxCardsPerPdf;
            doc.save(`bingo-cards-${startCard}-to-${endCard}.pdf`);
            pdfCount++;
            doc = new jsPDF();
        }

        const card = cards[i];
        const canvas = await html2canvas(card, { scale: 2 });
        const imgData = canvas.toDataURL('image/jpeg', 0.8);

        const x = margin + (i % 3) * (cardWidth + margin);
        const y = margin + Math.floor((i % cardsPerPage) / 3) * (cardHeight + margin);

        doc.addImage(imgData, 'JPEG', x, y, cardWidth, cardHeight);
        if (i > 0 && (i + 1) % cardsPerPage === 0 && (i + 1) < cards.length) {
            doc.addPage();
        }
    }

    const startCard = (pdfCount - 1) * maxCardsPerPdf + 1;
    const endCard = Math.min(pdfCount * maxCardsPerPdf, cards.length);
    doc.save(`bingo-cards-${startCard}-to-${endCard}.pdf`);
});

document.getElementById('searchInput').addEventListener('input', () => {
    const searchTerm = document.getElementById('searchInput').value.trim().toLowerCase();
    const cards = document.querySelectorAll('.bingo-card');
    cards.forEach(card => {
        const name = card.querySelector('.card-name-input').value.trim().toLowerCase();
        // Updated selector target for serial to fix the bug introduced by UI redesign
        const serial = card.querySelector('.card-serial').textContent.toLowerCase();

        if (name.includes(searchTerm) || serial.includes(searchTerm)) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
});

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    initializeBallsGrid();
    document.getElementById('generateNumber').addEventListener('click', generateRandomNumber);
    document.getElementById('generateCards').addEventListener('click', generateCards);
    document.getElementById('deleteSelectedCardsButton').addEventListener('click', deleteSelectedCards);

    const figureModeCheckbox = document.getElementById('figureMode');
    const gameModeDisplay = document.getElementById('gameMode');

    figureModeCheckbox.addEventListener('change', () => {
        if (figureModeCheckbox.checked) {
            gameModeDisplay.textContent = 'Modo: Figura';
        } else {
            gameModeDisplay.textContent = 'Modo: Normal';
        }
    });

    // Initialize the game mode display based on the checkbox state
    if (figureModeCheckbox.checked) {
        gameModeDisplay.textContent = 'Modo: Figura';
    } else {
        gameModeDisplay.textContent = 'Modo: Normal';
    }

    // Habilitar el checkbox de activación del modo figura al cargar la página
    figureModeCheckbox.disabled = false;

    // Habilitar los botones de eliminación de cartones al cargar la página
    document.querySelectorAll('.delete-card-button').forEach(button => {
        button.disabled = false;
    });
    document.getElementById('deleteSelectedCardsButton').disabled = false;

    // Reset Button Event Listener
    document.getElementById('resetGameButton').addEventListener('click', showNewGameConfirm);

    // New Game Modal Event Listeners
    document.getElementById('newGameYesbtn').addEventListener('click', executeNewGame);
    document.getElementById('newGameNobtn').addEventListener('click', () => {
        const overlay = document.getElementById('newGameConfirmOverlay');
        document.getElementById('newGameModalContent').classList.remove('scale-100');
        document.getElementById('newGameModalContent').classList.add('scale-95');
        setTimeout(() => overlay.classList.add('hidden'), 300);
    });

    // Cargar el juego guardado en local (recovery silencioso) si existe
    autoLoad();

    // Listeners de Exportar / Importar
    document.getElementById('exportGameButton').addEventListener('click', exportGame);

    document.getElementById('importGameInput').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const gameState = JSON.parse(e.target.result);
                applyGameState(gameState);
                showMessage('Partida cargada exitosamente.');
                // Limpiar el input para permitir cargar el mismo archivo dos veces si se desea
                event.target.value = '';
            } catch (err) {
                console.error("Error al parsear el JSON de la partida:", err);
                showMessage('Error: El archivo no es válido.');
            }
        };
        reader.readAsText(file);
    });

    // ============================================================
    // Panel de Pagos del Animador (Agrupado por comprador)
    // ============================================================
    let pendingPayments = {}; // { serial: { buyer, status, paymentData, reservedAt } }

    function renderPaymentsPanel() {
        const list = document.getElementById('paymentsList');
        const countBadge = document.getElementById('pendingPaymentsCount');
        const entries = Object.entries(pendingPayments);

        // Agrupar por comprador
        const grouped = {};
        entries.forEach(([serial, p]) => {
            if (!grouped[p.buyer]) {
                grouped[p.buyer] = { buyer: p.buyer, cards: [], paymentData: null, hasPaymentSent: false };
            }
            grouped[p.buyer].cards.push({ serial, ...p });
            if (p.status === 'payment_sent') {
                grouped[p.buyer].hasPaymentSent = true;
                if (p.paymentData) grouped[p.buyer].paymentData = p.paymentData;
            }
        });

        const buyers = Object.values(grouped);
        countBadge.textContent = buyers.length;

        if (buyers.length === 0) {
            list.innerHTML = '<div class="text-gray-500 text-sm italic text-center py-4">No hay pagos pendientes.</div>';
            return;
        }

        list.innerHTML = '';
        buyers.forEach(group => {
            const entry = document.createElement('div');
            entry.className = 'payment-entry';

            const totalAmount = group.cards.length * cardPrice;
            const cardSerials = group.cards.map(c => `#${c.serial}`).join(', ');
            const statusClass = group.hasPaymentSent ? 'payment-sent' : 'reserved';
            const statusText = group.hasPaymentSent ? 'Pago Enviado' : 'Esperando Pago';

            let paymentDataHtml = '';
            if (group.paymentData && group.hasPaymentSent) {
                paymentDataHtml = `
                    <div class="payment-data-grid">
                        <div class="data-item">
                            <span class="data-label">Teléfono</span>
                            <span class="data-value">${group.paymentData.phone || '—'}</span>
                        </div>
                        <div class="data-item">
                            <span class="data-label">Banco</span>
                            <span class="data-value">${group.paymentData.bank || '—'}</span>
                        </div>
                        <div class="data-item">
                            <span class="data-label">Cédula</span>
                            <span class="data-value">${group.paymentData.cedula || '—'}</span>
                        </div>
                    </div>
                `;
            }

            let actionsHtml = '';
            if (group.hasPaymentSent) {
                actionsHtml = `
                    <div class="payment-actions">
                        <button class="btn-confirm" onclick="confirmPaymentBatch('${group.buyer}')">
                            <i data-lucide="check" class="w-3.5 h-3.5"></i> Confirmar Todo
                        </button>
                        <button class="btn-reject" onclick="rejectPaymentBatch('${group.buyer}')">
                            <i data-lucide="x" class="w-3.5 h-3.5"></i> Rechazar Todo
                        </button>
                    </div>
                `;
            } else {
                actionsHtml = `
                    <div class="payment-actions">
                        <button class="btn-reject" onclick="rejectPaymentBatch('${group.buyer}')">
                            <i data-lucide="x" class="w-3.5 h-3.5"></i> Liberar Todo
                        </button>
                    </div>
                `;
            }

            entry.innerHTML = `
                <div class="flex items-center justify-between mb-1">
                    <div class="flex items-center gap-2">
                        <span class="text-white font-bold text-sm">${group.buyer}</span>
                        <span class="text-gray-400 text-xs">${group.cards.length} cartón(es) · $${totalAmount}</span>
                    </div>
                    <span class="payment-status ${statusClass}">${statusText}</span>
                </div>
                <div class="text-xs text-gray-500 mb-1">Cartones: ${cardSerials}</div>
                ${paymentDataHtml}
                ${actionsHtml}
            `;

            list.appendChild(entry);
        });

        if (window.lucide) window.lucide.createIcons();
    }

    // Asignar nombre del comprador al cartón en la vista del animador
    function assignBuyerNameToCard(serial, buyerName) {
        const cards = document.querySelectorAll('.bingo-card');
        cards.forEach(card => {
            if (card.dataset.cardIndex === String(serial)) {
                const nameInput = card.querySelector('.card-name-input');
                if (nameInput && !nameInput.value) {
                    nameInput.value = buyerName;
                }
            }
        });
    }

    // Socket.IO listeners para pagos
    if (socket) {
        socket.on('card-purchased', (data) => {
            pendingPayments[data.serial] = {
                buyer: data.buyer,
                status: data.status || 'reserved',
                paymentData: null,
                reservedAt: data.reservedAt
            };
            assignBuyerNameToCard(data.serial, data.buyer);
            renderPaymentsPanel();
            showMessage(`"${data.buyer}" reservó el cartón #${data.serial}`);
        });

        socket.on('payment-submitted', (data) => {
            if (pendingPayments[data.serial]) {
                pendingPayments[data.serial].status = 'payment_sent';
                pendingPayments[data.serial].paymentData = data.paymentData;
            } else {
                pendingPayments[data.serial] = {
                    buyer: data.buyer,
                    status: 'payment_sent',
                    paymentData: data.paymentData,
                    reservedAt: null
                };
            }
            renderPaymentsPanel();
            showMessage(`"${data.buyer}" envió comprobante de pago para cartón #${data.serial}`);
        });

        socket.on('payment-confirmed', (data) => {
            delete pendingPayments[data.serial];
            renderPaymentsPanel();
        });

        socket.on('card-released', (data) => {
            delete pendingPayments[data.serial];
            renderPaymentsPanel();
            const cards = document.querySelectorAll('.bingo-card');
            cards.forEach(card => {
                if (card.dataset.cardIndex === String(data.serial)) {
                    const nameInput = card.querySelector('.card-name-input');
                    if (nameInput && nameInput.value === data.buyer) {
                        nameInput.value = '';
                    }
                }
            });
        });

        socket.on('game-paused', (data) => {
            // Bloquear generación de bolas
            const genBtn = document.getElementById('generateNumber');
            if (genBtn) genBtn.disabled = true;

            // Use the unified winner verification modal
            const overlay = document.getElementById('winnerQuestionOverlay');
            const overlayText = document.getElementById('winnerQuestionText');
            const winnerCardImage = document.getElementById('winnerCardImage');
            const yesButton = document.getElementById('winnerYes');
            const noButton = document.getElementById('winnerNo');

            // Find and capture the card
            const cardEl = document.querySelector(`.bingo-card[data-card-index="${data.cardSerial}"]`);
            const modalTitle = document.querySelector('#winnerModalContent h2');
            if (modalTitle) modalTitle.textContent = `🎤 "${data.playerName}" cantó ${data.claimType}`;
            overlayText.textContent = `Cartón #${data.cardSerial} — Verifique el cartón del jugador`;

            if (cardEl) {
                html2canvas(cardEl, { backgroundColor: '#0f172a', scale: 2 }).then(canvas => {
                    winnerCardImage.src = canvas.toDataURL('image/png');
                    winnerCardImage.style.display = '';
                }).catch(() => {
                    winnerCardImage.style.display = 'none';
                });
            } else {
                winnerCardImage.style.display = 'none';
            }

            yesButton.textContent = '✓ Válido';
            noButton.textContent = '✗ Inválido';

            yesButton.onclick = () => {
                overlay.classList.add('hidden');
                resolveClaimFromAnimator(data.playerName, data.cardSerial, data.claimType, true);
            };
            noButton.onclick = () => {
                overlay.classList.add('hidden');
                resolveClaimFromAnimator(data.playerName, data.cardSerial, data.claimType, false);
            };

            overlay.classList.remove('hidden');
            document.getElementById('winnerModalContent').classList.add('scale-100');
            document.getElementById('winnerModalContent').classList.remove('scale-95');
        });

        socket.on('claim-result', (data) => {
            // Re-habilitar generación de bolas
            const genBtn = document.getElementById('generateNumber');
            if (genBtn) genBtn.disabled = false;

            const overlay = document.getElementById('winnerQuestionOverlay');
            overlay.classList.add('hidden');

            const msgBox = document.getElementById('messageBox');
            msgBox.classList.add('hidden');
            document.getElementById('closeMessageBox').style.display = '';

            if (data.valid) {
                showMessage(`✅ "${data.playerName}" ganó ${data.claimType} con cartón #${data.cardSerial}. ¡Verificado!`);
            } else {
                showMessage(`❌ Claim de "${data.playerName}" (${data.claimType}) fue rechazado. El juego continúa.`);
            }
        });

        // === GAME-ENDED: Bingo validated, show post-game modal ===
        socket.on('game-ended', (data) => {
            allTimeWinnersCache = data.allTimeWinners || [];
            showGameEndedModal(data);
        });

        // === GAME-BREAK: Receso ===
        socket.on('game-break', (data) => {
            showMessage(`⏸️ Receso de ${data.minutes} minuto(s). El juego se reanudará pronto.`);
        });
    }

    // Cargar pagos pendientes al inicio
    fetch('/api/payments/pending').then(res => res.json()).then(data => {
        if (data.pending) {
            data.pending.forEach(p => {
                pendingPayments[p.serial] = {
                    buyer: p.buyer,
                    status: p.status,
                    paymentData: p.paymentData,
                    reservedAt: p.reservedAt
                };
                assignBuyerNameToCard(p.serial, p.buyer);
            });
            renderPaymentsPanel();
        }
    }).catch(err => console.error('Error cargando pagos pendientes:', err));

    // ============================================================
    // Payment Config (Datos de pago del animador)
    // ============================================================
    // Cargar config existente
    fetch('/api/payment-config').then(res => res.json()).then(data => {
        if (data.bank) document.getElementById('payConfigBank').value = data.bank;
        if (data.phone) document.getElementById('payConfigPhone').value = data.phone;
        if (data.cedula) document.getElementById('payConfigCedula').value = data.cedula;
    }).catch(err => console.error('Error cargando config de pago:', err));

    // Guardar config
    document.getElementById('savePaymentConfigBtn').addEventListener('click', async () => {
        const bank = document.getElementById('payConfigBank').value.trim();
        const phone = document.getElementById('payConfigPhone').value.trim();
        const cedula = document.getElementById('payConfigCedula').value.trim();

        try {
            const res = await fetch('/api/payment-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bank, phone, cedula })
            });
            if (res.ok) {
                const statusEl = document.getElementById('payConfigStatus');
                statusEl.textContent = '✓ Datos guardados y emitidos a jugadores';
                statusEl.className = 'text-xs text-center text-emerald-400';
                statusEl.classList.remove('hidden');
                setTimeout(() => statusEl.classList.add('hidden'), 3000);
            }
        } catch (err) {
            console.error('Error guardando config de pago:', err);
        }
    });

    // Inicializar iconos de Lucide al cargar la página
    if (window.lucide) {
        window.lucide.createIcons();
    }
});

// Batch confirm (all cards of a buyer)
async function confirmPaymentBatch(buyer) {
    try {
        const res = await fetch('/api/cards/confirm-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ buyer })
        });
        const data = await res.json();
        if (res.ok) {
            showMessage(`Pago de "${buyer}" confirmado (${data.confirmed?.length || 0} cartones).`);
        } else {
            showMessage(data.error || 'Error al confirmar.');
        }
    } catch (err) {
        console.error('Error confirmando pago batch:', err);
    }
}

// Batch reject (all cards of a buyer)
async function rejectPaymentBatch(buyer) {
    try {
        const res = await fetch('/api/cards/reject-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ buyer })
        });
        const data = await res.json();
        if (res.ok) {
            showMessage(`Cartones de "${buyer}" liberados (${data.released?.length || 0}).`);
        } else {
            showMessage(data.error || 'Error al rechazar.');
        }
    } catch (err) {
        console.error('Error rechazando pago batch:', err);
    }
}

// Keep legacy single-card functions for compatibility
async function confirmPayment(serial) {
    try {
        const res = await fetch(`/api/cards/${serial}/confirm-payment`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            showMessage(`Pago del cartón #${serial} confirmado.`);
        } else {
            showMessage(data.error || 'Error al confirmar.');
        }
    } catch (err) {
        console.error('Error confirmando pago:', err);
    }
}

async function rejectPayment(serial) {
    try {
        const res = await fetch(`/api/cards/${serial}/reject-payment`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            showMessage(`Cartón #${serial} liberado.`);
        } else {
            showMessage(data.error || 'Error al rechazar.');
        }
    } catch (err) {
        console.error('Error rechazando pago:', err);
    }
}

// ============================================================
// Socket listener: game-started — ventas cerradas, recalcular pote
// ============================================================
if (socket) {
    socket.on('game-started', (data) => {
        console.log(`[ANIMATOR] Partida iniciada. Cartones en juego: ${data.soldCount}, Removidos: ${data.removedCount}`);

        // Eliminar del DOM los cartones que no están en la lista de vendidos
        const soldSerials = new Set(data.cards.map(c => String(c.serial)));
        const container = document.getElementById('bingoCards');
        const allCardElements = container.querySelectorAll('.bingo-card');

        allCardElements.forEach(cardEl => {
            const serial = String(cardEl.dataset.cardIndex);
            if (!soldSerials.has(serial)) {
                cardEl.remove();
            }
        });

        // Actualizar el pote con los datos del servidor
        totalPrize = data.totalPrize;
        recalculatePrizes();

        // Mostrar mensaje informativo
        if (data.removedCount > 0) {
            showMessage(`🎯 Partida iniciada. ${data.removedCount} cartón(es) no vendido(s) eliminado(s). Pote recalculado: $${data.totalPrize.toFixed(2)}`);
        } else {
            showMessage(`🎯 Partida iniciada. Todos los cartones fueron vendidos. Pote: $${data.totalPrize.toFixed(2)}`);
        }

        autoSave();
    });
}

// ============================================================
// Resolve Claim from animator (Verificar o rechazar canto)
// ============================================================
function resolveClaimFromAnimator(playerName, cardSerial, claimType, valid) {
    if (socket) {
        socket.emit('claim-result', {
            playerName,
            cardSerial,
            claimType,
            valid
        });
    }
    // Cerrar el mensaje y el modal de verificación
    const msgBox = document.getElementById('messageBox');
    msgBox.classList.add('hidden');
    document.getElementById('closeMessageBox').style.display = '';
    const overlay = document.getElementById('winnerQuestionOverlay');
    if (overlay) overlay.classList.add('hidden');
}

// ============================================================
// Game-Ended Modal (Animator) — Post-Bingo
// ============================================================
function showGameEndedModal(data) {
    const modal = document.getElementById('gameEndedOverlay');
    if (!modal) return;

    const winnersHtml = (data.winners || []).map(w => {
        let icon = 'award', color = 'text-emerald-400';
        if (w.prizeType && w.prizeType.includes('Figura')) { icon = 'star'; color = 'text-blue-400'; }
        else if (w.prizeType && w.prizeType.includes('Línea')) { icon = 'medal'; color = 'text-orange-400'; }
        return `<div class="flex items-center gap-2 p-2 rounded-lg bg-white/5 border border-white/10">
            <i data-lucide="${icon}" class="w-4 h-4 ${color}"></i>
            <span class="text-white font-bold text-sm">#${w.cardIndex || w.cardSerial || '?'}</span>
            <span class="text-xs ${color} font-bold uppercase">${w.prizeType || '?'}</span>
        </div>`;
    }).join('');

    document.getElementById('gameEndedContent').innerHTML = `
        <div class="w-16 h-16 bg-gradient-to-br from-yellow-500 to-amber-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-yellow-500/40">
            <span style="font-size: 2rem;">🏆</span>
        </div>
        <h2 class="text-2xl font-bold text-white mb-1 font-display">¡Partida Finalizada!</h2>
        <p class="text-sm text-gray-400 mb-4">ID: ${data.gameId || currentGameId} — Pote: $${(data.totalPrize || 0).toFixed(2)}</p>
        <div class="mb-4">
            <h4 class="text-xs text-yellow-400 uppercase tracking-wider mb-2 font-bold">Ganadores de esta ronda</h4>
            <div class="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar">${winnersHtml || '<p class="text-gray-500 text-sm italic">No hubo ganadores.</p>'}</div>
        </div>
        <div class="flex gap-3">
            <button onclick="document.getElementById('gameEndedOverlay').classList.add('hidden'); showNewGameConfirm();"
                class="flex-1 bg-gradient-to-r from-emerald-600 to-green-600 text-white font-bold py-3 px-4 rounded-xl shadow-lg hover:shadow-emerald-500/30 transition-all flex items-center justify-center gap-2">
                <i data-lucide="play" class="w-5 h-5"></i> Nueva Partida
            </button>
            <button onclick="showBreakPrompt()"
                class="flex-1 bg-gradient-to-r from-amber-600 to-yellow-600 text-white font-bold py-3 px-4 rounded-xl shadow-lg hover:shadow-amber-500/30 transition-all flex items-center justify-center gap-2">
                <i data-lucide="coffee" class="w-5 h-5"></i> Dar Receso
            </button>
        </div>
    `;

    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
}

function showBreakPrompt() {
    const minutes = prompt('¿Cuántos minutos de receso?', '5');
    if (minutes && !isNaN(parseInt(minutes))) {
        if (socket) socket.emit('game-break', { minutes: parseInt(minutes) });
        document.getElementById('gameEndedOverlay').classList.add('hidden');
        showMessage(`⏸️ Receso de ${minutes} minuto(s) notificado a todos los jugadores.`);
    }
}

// ============================================================
// Winners History Modal (Persistent)
// ============================================================
function showWinnersHistoryModal() {
    const modal = document.getElementById('winnersHistoryOverlay');
    if (!modal) return;
    renderWinnersHistoryContent();
    modal.classList.remove('hidden');
}

function closeWinnersHistoryModal() {
    const modal = document.getElementById('winnersHistoryOverlay');
    if (modal) modal.classList.add('hidden');
}

function renderWinnersHistoryContent() {
    const container = document.getElementById('winnersHistoryList');
    if (!container) return;

    // Merge current session winners with allTimeWinnersCache
    const allWinners = allTimeWinnersCache.length > 0 ? allTimeWinnersCache : [];

    if (allWinners.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-sm italic text-center py-4">No hay ganadores registrados.</p>';
        return;
    }

    // Group by gameId
    const groups = {};
    allWinners.forEach(w => {
        const gid = w.gameId || 'Sin ID';
        if (!groups[gid]) groups[gid] = [];
        groups[gid].push(w);
    });

    let html = '';
    Object.entries(groups).reverse().forEach(([gid, winners]) => {
        html += `<div class="mb-4">
            <div class="text-xs text-gray-400 uppercase tracking-wider mb-2 font-bold border-b border-white/10 pb-1 flex items-center gap-2">
                <i data-lucide="hash" class="w-3 h-3"></i> Partida ${gid}
            </div>
            <div class="space-y-1.5">`;
        winners.forEach(w => {
            let icon = 'award', color = 'text-emerald-400';
            if (w.prizeType && w.prizeType.includes('Figura')) { icon = 'star'; color = 'text-blue-400'; }
            else if (w.prizeType && w.prizeType.includes('Línea')) { icon = 'medal'; color = 'text-orange-400'; }
            if (w.prizeType && w.prizeType.includes('No cantado')) { icon = 'x-circle'; color = 'text-red-400'; }
            html += `<div class="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                <div class="flex items-center gap-2">
                    <i data-lucide="${icon}" class="w-3.5 h-3.5 ${color}"></i>
                    <span class="text-white font-bold text-xs">#${w.cardIndex || '?'}</span>
                </div>
                <span class="text-[10px] font-bold ${color} uppercase">${w.prizeType || '?'}</span>
                <button onclick="openWinnerPaymentForm('${gid}', '${w.cardIndex || ''}', '${(w.prizeType || '').replace(/'/g, "\\'")}')"
                    class="text-xs text-cyan-400 hover:text-cyan-300 transition-colors px-2 py-1 rounded bg-cyan-500/10 border border-cyan-500/20">
                    <i data-lucide="wallet" class="w-3 h-3 inline"></i> Pagar
                </button>
            </div>`;
        });
        html += '</div></div>';
    });

    container.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
}

// ============================================================
// Winner Payment Form
// ============================================================
function openWinnerPaymentForm(gameId, cardSerial, mode) {
    const modal = document.getElementById('winnerPaymentFormOverlay');
    if (!modal) return;
    document.getElementById('wpfGameId').textContent = gameId;
    document.getElementById('wpfCardSerial').textContent = '#' + cardSerial;
    document.getElementById('wpfMode').textContent = mode;
    document.getElementById('wpfAmount').value = '';
    document.getElementById('wpfName').value = '';
    document.getElementById('wpfCedula').value = '';
    document.getElementById('wpfBank').value = '';
    document.getElementById('wpfPhone').value = '';
    document.getElementById('wpfMethod').value = 'pago_movil';

    // Store context
    modal.dataset.gameId = gameId;
    modal.dataset.cardSerial = cardSerial;
    modal.dataset.mode = mode;

    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
}

function closeWinnerPaymentForm() {
    const modal = document.getElementById('winnerPaymentFormOverlay');
    if (modal) modal.classList.add('hidden');
}

async function submitWinnerPayment() {
    const modal = document.getElementById('winnerPaymentFormOverlay');
    const gameId = modal.dataset.gameId;
    const cardSerial = modal.dataset.cardSerial;
    const mode = modal.dataset.mode;
    const amount = parseFloat(document.getElementById('wpfAmount').value) || 0;
    const name = document.getElementById('wpfName').value.trim();
    const cedula = document.getElementById('wpfCedula').value.trim();
    const bank = document.getElementById('wpfBank').value.trim();
    const phone = document.getElementById('wpfPhone').value.trim();
    const method = document.getElementById('wpfMethod').value;

    if (!name || !amount) {
        showMessage('Complete al menos nombre y monto.');
        return;
    }

    try {
        const res = await fetch('/api/winners/payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gameId, cardSerial, mode,
                prize: mode,
                amount,
                paymentData: { name, cedula, bank, phone, method }
            })
        });
        const data = await res.json();
        if (res.ok) {
            showMessage(`✅ Pago de $${amount} registrado para cartón #${cardSerial}.`);
            closeWinnerPaymentForm();
        } else {
            showMessage(data.error || 'Error al registrar pago.');
        }
    } catch (err) {
        console.error('Error registrando pago:', err);
        showMessage('Error de conexión.');
    }
}

// Load allTimeWinners on page load
fetch('/api/winners').then(r => r.json()).then(data => {
    allTimeWinnersCache = data.winners || [];
}).catch(e => console.error('Error cargando historial de ganadores:', e));