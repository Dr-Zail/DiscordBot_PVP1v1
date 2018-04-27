const Discord = require('discord.js');
const options = require('./options.json');
require('dotenv').config();
const moment = require("moment");
const sqlite3 = require("sqlite3"),
    TransactionDatabase = require("sqlite3-transactions").TransactionDatabase;

var db = new TransactionDatabase(
    new sqlite3.Database("./duel_scores.sqlite", sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE)
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

    this.CheckRankAndDivisionForDuel = function(challengerId, player1Id, player1Div, player1Rank, player2Id, player2Div, player2Rank) {
        //Players not in same division
        if (player1Div != player2Div)
            return false;

        //Not sure about the order of playerId when retrieved from the DB, so check against challengerId and then check rank order
        if (challengerId == player1Id && player1Rank > player2Rank) {
            return true;
        }
        else if (challengerId == player2Id && player2Rank > player1Rank) {
            return true;
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
    this.CommandRegister = function(message) {
        try {
            db.beginTransaction(function(err, transaction) {
                transaction.run('INSERT INTO Players (userId, division, rank) VALUES (?, (SELECT NextRegister_Division FROM Info), (SELECT NextRegister_Rank FROM Info))', [message.author.id]);

                //See http://sql.sh/cours/case -> UPDATE avec CASE
                transaction.run('UPDATE Info SET NextRegister_Division = (CASE WHEN NextRegister_Division == 0 THEN 1 WHEN NextRegister_Division == 1 THEN 2 FROM Info), NextRegister_Rank = ((SELECT NextRegister_Rank FROM Info) + 1) WHERE id >= 0');

                transaction.commit(function(err) {
                    if (err)
                        return console.log(err);
                    else
                        message.channel.send(message.author + ' inscris pour les duels (division: ' + 0 + ' rank: ' + 0 + ')!');
                });
            });

            // db.run('INSERT INTO Players (userId, division, rank) VALUES (?, (SELECT NextRegister_Division FROM Info), (SELECT NextRegister_Rank FROM Info))', [message.author.id], function(err) {
            //     if (err) {
            //         if (err.code == 'SQLITE_CONSTRAINT')
            //             message.channel.send(message.author + ' deja inscris');
            //         else
            //             console.log(err);
            //     } else
            //         message.channel.send(message.author + ' inscris pour les duels (division: ' + 0 + ' rank: ' + 0 + ')!');
            // });
        } catch (err) {
            console.log(err);
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

            //Check last duel declaration was at least 24h ago
            db.get('SELECT lastDuelDeclarationTime FROM Players WHERE userId = ?', [message.author.id], function(err, row) {
                if (row != undefined) {
                    console.log('lastDuelDeclarationTime: ' + row.lastDuelDeclarationTime);
                    var declDate = moment(row.lastDuelDeclarationTime, 'YYYY-MM-DD HH:mm:ss');
                    var diff = moment().diff(declDate, 'minutes');

                    if (diff < options.hoursBeforeChallenge * 60) {
                        message.channel.send('Impossible de declarer un duel, derniere declaration de duel par ' + message.author + ' ete il y a moins de ' + options.hoursBeforeChallenge + ' heures (' + row.lastDuelDeclarationTime + ')');
                        return;
                    }
                }

                //Check player rank and division against challenged player
                db.all('SELECT userId, rank, division FROM Players WHERE userId IN (?, ?)', [message.author.id, message.mentions.users.array()[0].id], function(err, row) {
                    if (err) {
                        console.log(err);
                        return;
                    }

                    //Not enough players info found (someone may not be registered)
                    //Should not happen because we already checked if both players were registered
                    if (row.length < 2) {
                        console.log(err);
                        return;
                    }

                    console.log(row);
                    console.log('Player1 id: ' + row[0].userId + ' rank: ' + row[0].rank + ' division: ' + row[0].division);
                    console.log('Player2 id: ' + row[1].userId + ' rank: ' + row[1].rank + ' division: ' + row[1].division);

                    if (helperFunctions.CheckRankAndDivisionForDuel(message.author.id, row[0].userId, row[0].division, row[0].rank, row[1].userId, row[1].division, row[1].rank)) {
                    //Make sure player can declare duel to other player according to rank and division
                        db.beginTransaction(function(err, transaction) {
                            transaction.run('INSERT INTO OnGoingDuels(defyingPlayer, defiedPlayer, declarationTime) VALUES(?, ?, ?)', [message.author.id, message.mentions.users.array()[0].id, moment().format('YYYY-MM-DD HH:mm:ss')]);

                            transaction.run('UPDATE Players SET lastDuelDeclarationTime = (?) WHERE userId = ?', [moment().format('YYYY-MM-DD HH:mm:ss'), message.author.id]);

                            transaction.commit(function(err) {
                                if (err)
                                    return console.log(err);
                                else
                                    message.channel.send('Duel lance entre ' + message.author + ' et ' + message.mentions.users.array()[0]);
                            });
                        });
                    }
                    else {
                        message.channel.send('Impossible de declarer un duel, il faut etre dans la meme division et avoir un rang inferieur');
                    }
                });
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
