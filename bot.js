const Discord = require('discord.js');
const options = require('./options.json');
require('dotenv').config();
const moment = require("moment");
const sqlite = require("sqlite");
const sqlite3 = require("sqlite3"),
    TransactionDatabase = require("sqlite3-transactions").TransactionDatabase;

var db = new TransactionDatabase(
    new sqlite3.Database("./duel_scores.sqlite", sqlite3.OPEN_READWRITE)
);

//const dbPromise =+ sql.open("./duel_scores.sqlite", { Promise });

const client = new Discord.Client();

//DEBUG
const util = require('util')

//The class that contain all the command function
//All function are associated to a "functionName" value defined in the JSON corresponding file
var HelperClass = function() {

    //For most of the commands, player must already be registered, check DB to make sure he is
    this.IsPlayerRegistered = async function(userId) {
        try {
            var playerExists = await db.get('SELECT * FROM Players WHERE userId = ?', [userId], function(err, row) {
                if (err) {
                    console.log(err);
                    return false;
                }
                if (row == undefined)
                    return false;
                //TODO: Test if await/async is working properly
                console.log('Player is registered');
                return true;
            });
            return playerExists;
        } catch (err) {
            console.log(err);
            return false;
        }
        return false;
    }

    this.CheckRankAndDivisionForDuel = function(challenger, playerChallenged) {
        //Players not in same division
        if (challenger.division != playerChallenged.division)
            return false;

        //Challenger must have an inferior rank than the challenged player
        if (challenger.rank < playerChallenged.rank)
            return true;
        return false;
    }

    this.GetPlayerInfo = async function(playerId) {
        try {
            var playerInfo = await db.get('SELECT * FROM Players WHERE userId = ?', [playerId], function(err, row) {
                if (err) {
                    console.log(err);
                    return null;
                }
                return row;
            });
            //TODO: Test if await/async is working properly
            console.log('transac object: ' + playerInfo);
            return playerInfo;
        } catch (err) {
            console.log(err);
        }
        return null;
    }

    this.InsertNewPlayerInDB = async function(user) {
        try {
            var playerInserted = db.beginTransaction(function(err, transaction) {
                transaction.run('INSERT INTO Players (userId, division, rank)\
                                    VALUES (?, (SELECT NextRegister_Division FROM Info), (SELECT NextRegister_Rank FROM Info))', [user.id]);

                //Update the info for the next register command
                transaction.run('UPDATE Info SET NextRegister_Division = (CASE\
                                    WHEN NextRegister_Division == 1 AND NextRegister_Rank >= ? THEN 2\
                                    WHEN NextRegister_Division == 2 AND NextRegister_Rank >= ? THEN 3\
                                    ELSE NextRegister_Division\
                                    END),\
                                NextRegister_Rank = (CASE\
                                    WHEN NextRegister_Division == 1 AND NextRegister_Rank >= ? THEN 1\
                                    WHEN NextRegister_Division == 2 AND NextRegister_Rank >= ? THEN 1\
                                    ELSE NextRegister_Rank + 1\
                                    END)\
                                WHERE id >= 0', [options.divisions[0].nbPlayers, options.divisions[1].nbPlayers, options.divisions[0].nbPlayers, options.divisions[1].nbPlayers]);

                transaction.commit(function(err) {
                    if (err) {
                        console.log(err);
                        return false;
                    } else
                        return true;
                });
                return true;
            });
            return playerInserted;
        } catch (err) {
            console.log(err);
        }
        return false;
    }
}

var helperFunctions = new HelperClass();

//The class that contain all the command function
//All function are associated to a "functionName" value defined in the JSON corresponding file
var CommandClass = function() {

    //------------------------------------------------------------
    //----- 				HELP COMMAND					------
    //------------------------------------------------------------
    this.CommandHelp = function(message) {
        message.channel.send('help');
    };

    //------------------------------------------------------------
    //----- 				REGISTER COMMAND				------
    //------------------------------------------------------------
    this.CommandRegister = async function(message) {
        if (helperFunctions.InsertNewPlayerInDB(message.author)) {
            var playerInfo = helperFunctions.GetPlayerInfo(message.author.id);
            console.log('playerInfo' + playerInfo);
            if (playerInfo !== null)
                message.channel.send(message.author + ' inscris pour les duels (division: ' + playerInfo.division + ' rang: ' + playerInfo.rank + ')');
            else
                console.log('Error retrieving playerInfo from DB');
        }
    }

    //------------------------------------------------------------
    //----- 				CHALLENGE COMMAND				------
    //------------------------------------------------------------
    this.CommandChallenge = function(message) {
        //At least 1 user mention
        if (message.mentions.users.size != 1) return;
        //Cannot challenge self or bots ;)
        // if (message.mentions.users.array()[0].id === message.author.id || message.mentions.users.array()[0].id.bot) return;

        //Check if message author is registered
        if (!helperFunctions.IsPlayerRegistered(message.author.id)) {
            message.channel.send('Il faut etre inscris pour declarer un duel (' + message.author + ')');
            return;
        }

        //Check if challenged player is registered
        if (!helperFunctions.IsPlayerRegistered(message.mentions.users.array()[0].id)) {
            message.channel.send(message.mentions.users.array()[0].id + ' n\'est pas inscris pour les duels');
            return;
        }

        try {
            //TODO: Make only 1 request to get all players info
            db.all('SELECT * FROM Players WHERE userId IN (?, ?)', [message.author.id, message.mentions.users.array()[0].id], function(err, rows) {
                if (err) {
                    console.log(err);
                    return;
                }

                var challenger = rows[0].userId == message.author.id ? rows[0] : rows[1];
                var playerChallenged = rows[0].userId == message.author.id ? rows[1] : rows[0];

                //Check last duel declaration was at least 24h ago
                console.log('lastDuelDeclarationTime: ' + challenger.lastDuelDeclarationTime);
                var declDate = moment(challenger.lastDuelDeclarationTime, 'YYYY-MM-DD HH:mm:ss');
                var diff = moment().diff(declDate, 'minutes');
                if (diff < options.hoursBeforeChallenge * 60) {
                    message.channel.send('Impossible de declarer un duel, derniere declaration de duel par ' + message.author + ' ete il y a moins de ' + options.hoursBeforeChallenge + ' heures (' + challenger.lastDuelDeclarationTime + ')');
                    return;
                }

                //Check player rank and division against challenged player
                console.log(row);
                console.log('Challenger id: ' + challenger.userId + ' rank: ' + challenger.rank + ' division: ' + challenger.division);
                console.log('Challenged id: ' + playerChallenged.userId + ' rank: ' + playerChallenged.rank + ' division: ' + playerChallenged.division);

                if (helperFunctions.CheckRankAndDivisionForDuel(challenger, playerChallenged)) {
                    //Make sure player can declare duel to other player according to rank and division
                    db.beginTransaction(function(err, transaction) {
                        transaction.run('INSERT INTO OnGoingDuels(defyingPlayer, defiedPlayer, declarationTime) VALUES(?, ?, ?)', [challenger.userId, playerChallenged.userID, moment().format('YYYY-MM-DD HH:mm:ss')]);

                        transaction.run('UPDATE Players SET lastDuelDeclarationTime = (?) WHERE userId = ?', [moment().format('YYYY-MM-DD HH:mm:ss'), message.author.id]);

                        transaction.commit(function(err) {
                            if (err)
                                return console.log(err);
                            else
                                message.channel.send('Duel lance entre ' + message.author + ' et ' + message.mentions.users.array()[0]);
                        });
                    });
                } else {
                    message.channel.send('Impossible de declarer un duel, il faut etre dans la meme division et avoir un rang inferieur');
                }
            });
        } catch (err) {
            console.log(err);
        }
    }

    //------------------------------------------------------------
    //----- 				RESULT COMMAND					------
    //------------------------------------------------------------
    this.CommandResult = function(message) {
        //Nothing to do here, all is done in the "messageReactionAdd" event
    }

    //------------------------------------------------------------
    //-----  		DISPLAY PLAYER LIST COMMAND				------
    //------------------------------------------------------------
    this.CommandDisplayPlayerList = function(message) {
        try {
            db.all('SELECT * FROM Players', function(err, rows) {
                console.log(err);

                console.log(util.inspect(rows));
                formattedPlayersLists = 'Joueurs:';

                rows.forEach((player) => {
                    formattedPlayersLists += '\n<@' + player.userId + '>' + ' division: ' + player.division + ' rank: ' + player.rank;
                });
                message.channel.send(formattedPlayersLists);
            });
        } catch (err) {
            console.log(err);
        }
    }

    //------------------------------------------------------------
    //-----     DISPLAY ON GOING DUELS FOR A PLAYER			------
    //------------------------------------------------------------
    this.CommandDisplayOnGoingDuels = function(message) {
        //Check if message author is registered
        if (!helperFunctions.IsPlayerRegistered(message.author.id)) {
            message.channel.send('Il faut etre inscris pour afficher ses duels (' + message.author + ')');
            return;
        }

        try {
            db.all('SELECT * FROM OnGoingDuels WHERE defyingPlayer = ? OR defiedPlayer = ?', [message.author.id, message.author.id], function(err, rows) {
                if (err) {
                    console.log(err);
                    return;
                }

                console.log(util.inspect(rows));

                if (rows == null || rows.length == 0) {
                    message.channel.send('Vous n\'avez aucun duel en cours actuellement');
                    return;
                }

                formattedDuelLists = 'Duels:';
                rows.forEach((duel) => {
                    formattedDuelLists += '\n<@' + duel.defyingPlayer + '>' + ' VS <@' + duel.defiedPlayer + '>';
                });
                message.channel.send(formattedDuelLists);
            });
        } catch (err) {
            console.log(err);
        }
    }

    //------------------------------------------------------------
    //----- 		!!! 	ADMIN COMMANDS 		!!!			------
    //------------------------------------------------------------

    //------------------------------------------------------------
    //----- 			REGISTER ADMIN COMMAND				------
    //------------------------------------------------------------
    this.AdminCommandRegister = function(message) {
        //At least 1 mention of a user
        if (message.mentions.users.size != 1) return;
        //Cannot register bots ;)
        // if (message.mentions.users.first().bot) return;

        if (helperFunctions.InsertNewPlayerInDB(message.mentions.users.array()[0]))
            message.channel.send(message.mentions.users.array()[0] + ' inscris pour les duels (division: ' + row.division + ' rang: ' + row.rank + ')');
    }

    //------------------------------------------------------------
    //----- 			RESULT ADMIN COMMAND				------
    //------------------------------------------------------------
    this.AdminCommandResult = function(message) {
        //At least 1 mention of a user
        if (message.mentions.users.size != 1) return;
        //Cannot register bots ;)
        // if (message.mentions.users.first().bot) return;

        try {
            db.run("INSERT INTO Players (userId) VALUES (?)", [message.mentions.users.array()[0].id], function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT')
                        message.channel.send(message.mentions.users.array()[0] + ' deja inscris');
                    else
                        console.log(err);
                } else
                    message.channel.send(message.mentions.users.array()[0] + ' inscris pour les duels !');
            });
        } catch (err) {
            console.log(err);
        }
    }

    //------------------------------------------------------------
    //-----     DISPLAY ONGOING DUELS ADMIN COMMAND			------
    //------------------------------------------------------------
    this.AdminCommandDisplayOnGoingDuels = function(message) {
        //At least 1 mention of a user
        if (message.mentions.users.size != 1) return;
        //Cannot register bots ;)
        // if (message.mentions.users.first().bot) return;

        try {
            db.run("INSERT INTO Players (userId) VALUES (?)", [message.mentions.users.array()[0].id], function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT')
                        message.channel.send(message.mentions.users.array()[0] + ' deja inscris');
                    else
                        console.log(err);
                } else
                    message.channel.send(message.mentions.users.array()[0] + ' inscris pour les duels !');
            });
        } catch (err) {
            console.log(err);
        }
    }

    //------------------------------------------------------------
    //-----     CHANGE PLAYER RANK / DIVISION ADMIN COMMAND	------
    //------------------------------------------------------------
    this.AdminCommandChangePlayerRankAndDivision = function(message) {
        //At least 1 mention of a user
        if (message.mentions.users.size != 1) return;
        //Cannot register bots ;)
        // if (message.mentions.users.first().bot) return;

        try {
            db.run("INSERT INTO Players (userId) VALUES (?)", [message.mentions.users.array()[0].id], function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT')
                        message.channel.send(message.mentions.users.array()[0] + ' deja inscris');
                    else
                        console.log(err);
                } else
                    message.channel.send(message.mentions.users.array()[0] + ' inscris pour les duels !');
            });
        } catch (err) {
            console.log(err);
        }
    }
}



var commandsFunctions = new CommandClass();

var commandsArray = Object.values(options.commands);
var adminCommandsArray = Object.values(options.adminCommands);

//Parse message to match possible commands and call the associated function
function ParseMessageAndExecuteCommand(message) {
    //Test current message with all possible commands
    for (var commandIdx = 0; commandIdx < commandsArray.length; ++commandIdx) {
        var commandSyntaxes = Object.values(commandsArray[commandIdx].syntaxNames);
        //console.log(options.commands[command]);
        for (var syntaxIdx = 0; syntaxIdx < commandSyntaxes.length; ++syntaxIdx) {
            if (message.content.lastIndexOf(commandSyntaxes[syntaxIdx], 0) === 0) {
                console.log('Function call: ' + commandsArray[commandIdx].functionName);
                commandsFunctions[commandsArray[commandIdx].functionName](message);
                return;
            }
        }
    }

    //Player sending message has "admin" rights
    //if (message.author.id == 'ADMIN')
    {
        for (var adminCommandIdx = 0; adminCommandIdx < adminCommandsArray.length; ++adminCommandIdx) {
            var adminCommandSyntaxes = Object.values(adminCommandsArray[adminCommandIdx].syntaxNames);
            //console.log(options.commands[command]);
            for (var syntaxIdx = 0; syntaxIdx < adminCommandSyntaxes.length; ++syntaxIdx) {
                if (message.content.lastIndexOf(adminCommandSyntaxes[syntaxIdx], 0) === 0) {
                    console.log('Function call: ' + adminCommandsArray[adminCommandIdx].functionName);
                    commandsFunctions[adminCommandsArray[adminCommandIdx].functionName](message);
                    return;
                }
            }
        }
    }

    //------------------------------------------------------------
    //----- 			Messages non traités 				------
    //------------------------------------------------------------
    if (message.content.lastIndexOf('!', 0) === 0) {
        var commandLength = message.content.indexOf(' ', 2);
        message.channel.send('Commande inconue: ' + message.content.substr(0, (commandLength != -1 ? commandLength : message.content.length)));
        return;
    }
}

function IsExcludedMessage(message) {
    //Exclude bot messages (usually self-send messages)
    if (message.author.bot)
        return true;
    //Exclude message sent on the wrong channel (in case the permissions are not correctly set)
    if (message.channel.type != 'text' || message.channel.name != options.channelName)
        return true;
}

client.on('message', message => {
    if (IsExcludedMessage(message))
        return;

    console.log('message.content: ' + message.content);

    ParseMessageAndExecuteCommand(message);
});

//Callback on event messageReactionAdd to check result of a duel
client.on('messageReactionAdd', async (messageReaction, user) => {

    console.log('Add reaction!');

    //------------------------------------------------------------
    //----- 		Verifie le contenu du message quand		------
    //----- 		une reaction est ajoute					------
    //------------------------------------------------------------
    //Au moins 2 mention d'un autre utilisateur dans le message
    if (messageReaction.message.mentions.users.size < 2) return;

    //Verifie le formattage de la chaine et capture les noms des joueurs
    var regex = RegExp('!' + options.admin_commands.inscription + ' *(<@[0-9]*>) *VS *(<@[0-9]*>) *=* *(<@[0-9]*>)', 'gi');
    var result = regex.exec(messageReaction.message.content);

    if (result == null) return;

    //Verifie que les 2 participants ne sont pas le meme user
    if (result[1] != result[2]) return;
    //Verifie que le user qui a reagit au message fait partie de ceux mentionn� (pareil pour l'auteur)
    if (user.id != result[1] && user.id != result[2]) return;
    console.log('OK1');
    if (messageReaction.message.author.id != result[1] && messageReaction.message.author.id != result[2]) return;
    console.log('OK2');
    //Verifie que le gagnant est bien un des 2 participant ;)
    if (messageReaction.message.author.id != result[3] && user.id != result[2]) return;
    console.log('OK3');


    try {
        db.run('INSERT INTO DuelsDone(winner, loser, resultTime) VALUES(?, ?, datetime(\'now\'))', [result[3], result[2] != result[3] ? result[2] : result[1]], function(err) {
            console.log(err);
        });
        messageReaction.message.channel.send('Resultat confirme pour le duel entre ' + result[1] + ' et ' + result[2] + ' Vainqueur: ' + result[3]);
    } catch (err) {
        console.log(err);
    }

});

//Verify JSON and commands functions
function VerifyJSONAndCommandClass() {
    for (var commandIdx = 0; commandIdx < commandsArray.length; ++commandIdx) {
        if (!commandsFunctions.hasOwnProperty(commandsArray[commandIdx].functionName))
            console.log('ERROR: Missing function [[  ' + commandsArray[commandIdx].functionName + '  ]] in the CommandClass');
    }
}

client.on("ready", () => {
    VerifyJSONAndCommandClass();
});

client.login(process.env.DISCCORD_TOKEN);
