var io = require('socket.io-client');
var EE = require('events').EventEmitter;
var inherits = require('util').inherits;

var CONNECTION = 'http://scorebot2.hltv.org';
var PORT = 10022;

var that;

inherits(Scorebot, EE);

Scorebot.EOption = require('./enums/EOption.js');
Scorebot.ERoundType = require('./enums/ERoundType.js');
Scorebot.ESide = require('./enums/ESide.js');

function Scorebot() {
    this.connected = false;

    this.matchid = 0;
    this.listid = 0;
    this.ip = CONNECTION;
    this.port = PORT;

    this.socket = null;
    this.reconnect = false;

    this.time = 0;
    this.map;
    this.interval;

    this.scoreboard;

    this.players = {};
    this.teams = {};

    this.knifeKills = 0;

    this.options = {};

    this.options[Scorebot.EOption['ROUND_TIME']] = 115; // 105 before update
    this.options[Scorebot.EOption['BOMB_TIME']] = 40; // 35 before update
    this.options[Scorebot.EOption['FREEZE_TIME']] = 15;

    that = this;
}

Scorebot.prototype.connect = function() {
    this.connected = false;
    this.players = {};

    this.matchid = arguments[0];
    this.listid = arguments[1];

    if (typeof arguments[2] !== 'undefined') {
        if (arguments[2]) {
            this.emit('debug', 'using old round times');
            this.options[Scorebot.EOption['ROUND_TIME']] = 105; // 115 after update
            this.options[Scorebot.EOption['BOMB_TIME']] = 35; // 40 after update
        }
    }

    if (typeof arguments[3] !== 'undefined') {
        this.emit('debug', 'using non-default ip: ' + arguments[2]);
        this.ip = arguments[3];
    }

    if (typeof arguments[4] !== 'undefined') {
        this.emit('debug', 'using non-default port: ' + arguments[3]);
        this.port = arguments[4];
    }

    this.socket = io(this.ip + ':' + this.port);

    this.socket.on('connect', this._onConnect.bind(this));
};

Scorebot.prototype.disconnect = function() {
    this.connected = false;
    this.socket.disconnect();
};

Scorebot.prototype.getPlayers = function() {
    if (Object.keys(this.players).length !== 0) {
        return this.players;
    } else {
        return false;
    }
};

Scorebot.prototype.getTeams = function() {
    if (Object.keys(this.teams).length !== 0) {
        return this.teams;
    } else {
        return false;
    }
};

Scorebot.prototype.setTime = function(time) {
    clearInterval(this.interval);

    this.time = time;
    this.interval = setInterval(function() {
        this.time = this.time - 1;
        this.emit('time', this.time);
    }.bind(this), 1000);
};

Scorebot.prototype._onConnect = function() {
    if (!this.reconnect) {
        this.socket.on('log', this._onLog.bind(this));
        this.socket.on('scoreboard', this._onScoreboard.bind(this));
    }

    this.socket.emit('readyForMatch', this.listid);
};

Scorebot.prototype._onReconnect = function() {
    this.reconnect = true;
    this.socket.emit('readyForMatch', this.listid);
};

Scorebot.prototype._onLog = function(logs) {
    if (this.getPlayers()) {
        logs = JSON.parse(logs).log.reverse();
        logs.forEach(function(log) {
            for (event in log) {
                this.emit('debug', 'received event: ' + event);

                switch (event) {
                    case 'Kill':
                    case 'Assist':
                    case 'BombPlanted':
                    case 'BombDefused':
                    case 'RoundStart':
                    case 'RoundEnd':
                    case 'PlayerJoin':
                    case 'PlayerQuit':
                    case 'MapChange':
                    case 'MatchStarted':
                    case 'Restart':
                    case 'Suicide':
                        eval('this._on' + event + '(log[event])');
                    default:
                        this.emit('debug', 'unrecognized event: ' + event);
                        break;
                }
            }
        }.bind(this));
    }
};

Scorebot.prototype._onScoreboard = function(scoreboard) {
    if (!this.connected) {
        this.connected = true;
        this.emit('connected');
    }

    updateGame(scoreboard);

    this.emit('scoreboard', scoreboard);
};

Scorebot.prototype._onKill = function(event) {
    this.emit('kill', {
        killer: this.getPlayers()[event.killerName],
        victim: this.getPlayers()[event.victimName],
        weapon: event.weapon,
        headshot: event.headShot
    });

    if (event.weapon.indexOf('knife') > -1) {
        this.knifeKills++;
    }
};

Scorebot.prototype._onSuicide = function(event) {
    this.emit('suicide', {
        playerName: event.playerName,
        playerSide: event.side
    });
};

Scorebot.prototype._onBombPlanted = function(event) {
    this.setTime(this.options[Scorebot.EOption['BOMB_TIME']]);

    this.emit('bombPlanted', {
        player: this.getPlayers()[event.playerName]
    });
};

Scorebot.prototype._onBombDefused = function(event) {
    this.emit('bombDefused', {
        player: this.getPlayers()[event.playerName]
    });
};

Scorebot.prototype._onMatchStarted = function(event) {
    this.emit('matchStart', event);
};

Scorebot.prototype._onRoundStart = function() {
    this.setTime(this.options[Scorebot.EOption["ROUND_TIME"]]);
    this.emit('roundStart');

    this.knifeKills = 0;
};

Scorebot.prototype._onRoundEnd = function(event) {
    var teams = {};

    var winner;
    if (event.winner === 'TERRORIST') {
        winner = Scorebot.ESide['TERRORIST'];
    } else {
        winner = Scorebot.ESide['COUNTERTERRORIST'];
    }

    this.setTime(this.options[Scorebot.EOption["FREEZE_TIME"]]);

    var t = this.getTeams()[Scorebot.ESide['TERRORIST']];
    var ct = this.getTeams()[Scorebot.ESide['COUNTERTERRORIST']];

    t.score = event.terroristScore
    ct.score = event.counterTerroristScore;

    teams[Scorebot.ESide['TERRORIST']] = t;
    teams[Scorebot.ESide['COUNTERTERRORIST']] = ct;

    this.emit('roundEnd', {
        teams: teams,
        winner: this.getTeams()[winner],
        winType: event.winType,
        knifeRound: this.knifeKills >= 5
    });
};

Scorebot.prototype._onPlayerJoin = function(event) {
    this.emit('playerJoin', {
        playerName: event.playerName
    });
};

Scorebot.prototype._onPlayerQuit = function(event) {
    this.emit('playerQuit', {
        player: this.getPlayers()[event.playerName]
    });
};

Scorebot.prototype._onServerRestart = function() {
    this.emit('restart');
};

Scorebot.prototype._onMapChange = function(event) {
    this.emit('mapChange', event);
};

function updateGame(scoreboard) {
    scoreboard.TERRORIST.forEach(function(player) {
        that.players[player.name] = {
            steamId: player.steamId,
            dbId: player.dbId,
            name: player.name,
            score: player.score,
            deaths: player.deaths,
            assists: player.assists,
            alive: player.alive,
            rating: player.rating,
            money: player.money,
            side: Scorebot.ESide['TERRORIST'],
            team: {
                name: scoreboard.terroristTeamName,
                id: scoreboard.tTeamId
            }
        };
    });

    scoreboard.CT.forEach(function(player) {
        that.players[player.name] = {
            steamId: player.steamId,
            dbId: player.dbId,
            name: player.name,
            score: player.score,
            deaths: player.deaths,
            assists: player.assists,
            alive: player.alive,
            rating: player.rating,
            money: player.money,
            side: Scorebot.ESide['COUNTERTERRORIST'],
            team: {
                name: scoreboard.ctTeamName,
                id: scoreboard.ctTeamId
            }
        };
    });

    that.teams[Scorebot.ESide['TERRORIST']] = {
        name: scoreboard.terroristTeamName,
        id: scoreboard.tTeamId,
        score: scoreboard.terroristScore,
        side: Scorebot.ESide['TERRORIST']
    };

    that.teams[Scorebot.ESide['COUNTERTERRORIST']] = {
        name: scoreboard.ctTeamName,
        id: scoreboard.ctTeamId,
        score: scoreboard.counterTerroristScore,
        side: Scorebot.ESide['COUNTERTERRORIST']
    };

    that.scoreboard = scoreboard;
}

module.exports = Scorebot;
