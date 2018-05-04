const Discord = require('discord.js');
const options = require('./options.json');
require('dotenv').config();
const moment = require("moment");
const sqlite = require("better-sqlite3");
const util = require('util')

var db = new sqlite('./duel_scores.sqlite', options);

const client = new Discord.Client();
//----------------------------
//INSTALL better-sqlite3
//https://github.com/JoshuaWise/better-sqlite3/wiki/Troubleshooting-installation
//----------------------------

//The class that contain all the helper function (usually functions with DB queries)
var HelperClass = function() {

    //For most of the commands, player must already be registered, check DB to make sure he is
    this.IsPlayerRegistered = function(userId) {
        try {
            var playerExistRequest = db.prepare('SELECT * FROM Players WHERE userId = ?');
            var playerExists = playerExistRequest.get([userId]);
            if (playerExists === undefined)
                return false;
            return true;
        } catch (err) {
            console.log(err);
        }
        return false;
    }

    this.CheckRankAndDivisionForDuel = function(challenger, playerChallenged) {
        console.log('challenger: ' + util.inspect(challenger));
        console.log('playerChallenged: ' + util.inspect(playerChallenged));
        //Players not in same division
        if (challenger.division != playerChallenged.division)
            return false;

        //Challenger must have an inferior rank than the challenged player
        if (challenger.rank > playerChallenged.rank)
            return true;
        return false;
    }

    this.GetPlayerInfo = function(playerId) {
        try {
            var request = db.prepare('SELECT * FROM Players WHERE userId = ?');
            var playerInfo = request.get(playerId);
            return playerInfo;
        } catch (err) {
            console.log(err);
        }
        return undefined;
    }

    this.InsertNewPlayerInDB = function(user) {
        try {
            var transaction = db.transaction([
                'INSERT INTO Players (userId, division, rank)\
                    VALUES (@userId, (SELECT NextRegister_Division FROM Info), (SELECT NextRegister_Rank FROM Info))',
                'UPDATE Info SET NextRegister_Division = (CASE\
                                        WHEN NextRegister_Division == 1 AND NextRegister_Rank >= @division1_nbPlayers THEN 2\
                                        WHEN NextRegister_Division == 2 AND NextRegister_Rank >= @division2_nbPlayers THEN 3\
                                        ELSE NextRegister_Division\
                                        END),\
                                    NextRegister_Rank = (CASE\
                                        WHEN NextRegister_Division == 1 AND NextRegister_Rank >= @division1_nbPlayers THEN 1\
                                        WHEN NextRegister_Division == 2 AND NextRegister_Rank >= @division2_nbPlayers THEN 1\
                                        ELSE NextRegister_Rank + 1\
                                        END)\
                                    WHERE id >= 0'
            ]);

            var ret = transaction.run({userId: user.id, division1_nbPlayers: options.divisions[0].nbPlayers, division2_nbPlayers: options.divisions[1].nbPlayers});
            return true;
        } catch (err) {
            console.log(err);
            return err.code;
        }
        return false;
    }

    this.DoWeeklyUpdate = function(channel) {
        //TODO: Make a DB backup ;)

        //TODO: Make sure there are no pending duels
        try {
            //Retrieve all players info
            var allPlayersRequest = db.prepare('SELECT * FROM Players ORDER BY division, rank ASC');
            var allPlayers = allPlayersRequest.all();

            if (allPlayers.length < options.divisions[0].nbPlayers + 1) {
                console.log('Not enough players(' + allPlayers.length + ') to change divisions/ranks');
                return false,
            }

            //Check all info, and create necessary argument bindings to update players divisions and ranks
            var weeklyArgsBind = [];

            var defaultRequest = 'UPDATE SET division = @newDiv, rank = @newRank WHERE userId = @userId';
            var nbArgs = 0;  //Division offset
            var nbPlayersInPrevDiv = 0;
            //Iterate on divisions info set in the options
            //According to number of players that should go down
            for (var divisionIdx = 0; divisionIdx < options.divisions.length; ++divisionIdx) {
                //------- Make players go UP --------
                //No UP for division 1
                if (i > 0) {
                    var firstPlayerOffsetToGoUp = nbPlayersInPrevDiv;


                }

                //------- Make players go DOWN ------
                var firstPlayerOffsetToGoDown = nbPlayersInPrevDiv + options.divisions[divisionIdx].nbPlayers - options.divisions[divisionIdx].bottomPlayers - 1;

                for (var playerIdx = firstPlayerOffsetToGoDown; playerIdx < allPlayers.length; ++firstPlayerOffsetToGoDown) {
                    weeklyArgsBind[nbArgs++] = {userId: allPlayers[playerIdx]};
                }

                nbPlayersInPrevDiv += options.divisions[divisionIdx].nbPlayers;
            }

            var transactionWeeklyUpdate = db.transaction([
                'UPDATE Players(division, rank) SET(@division, @rank)',
            ]);

            //TODO: A request to check all players rank/division, make sure all rank follows each other and there no overlapping ranks
            return true;
        } catch (err) {
            console.log(err);
            return err.code;
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
        var ret = helperFunctions.InsertNewPlayerInDB(message.author)
        if (ret === true) {
            var playerInfo = helperFunctions.GetPlayerInfo(message.author.id);
            if (playerInfo !== undefined)
                message.channel.send(message.author + ' inscris pour les duels (division: ' + playerInfo.division + ' rang: ' + playerInfo.rank + ')');
            else
                console.log('Error retrieving playerInfo from DB');
        }
        else
            message.channel.send(message.author + ' deja inscris');
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
            message.channel.send(message.mentions.users.array()[0] + ' n\'est pas inscris pour les duels');
            return;
        }

        try {
            var playerInfoChallenger = helperFunctions.GetPlayerInfo(message.author.id);
            var challengedPlayerInfo = helperFunctions.GetPlayerInfo(message.mentions.users.array()[0].id);

            if (playerInfoChallenger === undefined || challengedPlayerInfo === undefined) {
                console.log('Error: cannot retrieve 1 of the player info for challenge command');
                return;
            }

            console.log('playerInfoChallenger:' + playerInfoChallenger + ' challengedPlayerInfo: ' + challengedPlayerInfo);

            //Check last duel declaration was at least 24h ago
            console.log('lastDuelDeclarationTime: ' + playerInfoChallenger.lastDuelDeclarationTime);
            var declDate = moment(playerInfoChallenger.lastDuelDeclarationTime, 'YYYY-MM-DD HH:mm:ss');
            var diff = moment().diff(declDate, 'minutes');
            if (diff < options.hoursBeforeChallenge * 60) {
                message.channel.send('Impossible de declarer un duel, derniere declaration de duel par ' + message.author + ' ete il y a moins de ' + options.hoursBeforeChallenge + ' heures (' + challenger.lastDuelDeclarationTime + ')');
                return;
            }
            //Check player rank and division against challenged player
            console.log('Challenger id: ' + playerInfoChallenger.userId + ' rank: ' + playerInfoChallenger.rank + ' division: ' + playerInfoChallenger.division);
            console.log('Challenged id: ' + challengedPlayerInfo.userId + ' rank: ' + challengedPlayerInfo.rank + ' division: ' + challengedPlayerInfo.division);
            //Make sure player can declare duel to other player according to rank and division
            if (helperFunctions.CheckRankAndDivisionForDuel(playerInfoChallenger, challengedPlayerInfo)) {
                var transactionChallenge = db.transaction(['INSERT INTO OnGoingDuels(defyingPlayer, defiedPlayer, declarationTime) VALUES(@defyingPlayer, @defiedPlayer, @declTime)',
                                                'UPDATE Players SET lastDuelDeclarationTime = (@declTime) WHERE userId = @userId']);

                var ret = transactionChallenge.run({defyingPlayer: playerInfoChallenger.userId, defiedPlayer: challengedPlayerInfo.userId, declTime: moment().format('YYYY-MM-DD HH:mm:ss'), userId: playerInfoChallenger.userId});
                message.channel.send('Duel lance entre ' + message.author + ' et ' + message.mentions.users.array()[0]);
            } else {
                message.channel.send('Impossible de declarer un duel, il faut etre dans la meme division et avoir un rang inferieur');
            }
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
            var playerListRequest = db.prepare('SELECT * FROM Players ORDER BY division, rank ASC');
            var playerList = playerListRequest.all();

            var formattedPlayersLists = 'Joueurs:\n\n ----- DIVISION 1 -----';

            var currentDivision = 1;
            playerList.forEach((player) => {
                if (currentDivision < player.division) {
                    formattedPlayersLists += '\n\n----- DIVISION ' + ++currentDivision + ' -----';
                }
                //For now display raw id, some id in DB are fake
                // formattedPlayersLists += '\n<@' + player.userId + '>' + ' division: ' + player.division + ' rank: ' + player.rank;
                formattedPlayersLists += '\n<' + player.userId + '>' + ' division: ' + player.division + ' rank: ' + player.rank;
            });
            message.channel.send(formattedPlayersLists);
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
            var playerDuelsRequest = db.prepare('SELECT * FROM OnGoingDuels WHERE defyingPlayer = @userId OR defiedPlayer = @userId');
            var playerDuels = playerDuelsRequest.all({userId: message.author.id});

            if (playerDuels === undefined || playerDuels.length == 0) {
                message.channel.send('Vous n\'avez aucun duel en cours actuellement');
                return;
            }
            formattedDuelLists = 'Duels:';
            playerDuels.forEach((duel) => {
                formattedDuelLists += '\n<@' + duel.defyingPlayer + '> VS <@' + duel.defiedPlayer + '>';
            });
            message.channel.send(formattedDuelLists);
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

        var ret = helperFunctions.InsertNewPlayerInDB(message.mentions.users.array()[0]);
        if (ret === true) {
            var playerInfo = helperFunctions.GetPlayerInfo(message.mentions.users.array()[0].id);
            if (playerInfo !== undefined)
                message.channel.send(message.mentions.users.array()[0] + ' inscris pour les duels (division: ' + playerInfo.division + ' rang: ' + playerInfo.rank + ')');
            else
                console.log('Error: cannot retreive player info after instert into DB');
        }
        else {
            message.channel.send(message.mentions.users.array()[0] + ' deja inscris');
        }
    }

    //------------------------------------------------------------
    //----- 		FORCE RESULT ADMIN COMMAND				------
    //------------------------------------------------------------
    this.AdminCommandForceResult = function(message) {
        //At least 1 mention of a user
        if (message.mentions.users.size != 2) return;
        //Cannot register bots ;)
        // if (message.mentions.users.first().bot) return;

        try {
        } catch (err) {
            console.log(err);
        }
    }

    //------------------------------------------------------------
    //-----     DISPLAY ALL ONGOING DUELS ADMIN COMMAND		------
    //------------------------------------------------------------
    this.AdminCommandDisplayAllOnGoingDuels = function(message) {
        try {
            var playerDuelsRequest = db.prepare('SELECT * FROM OnGoingDuels');
            var playerDuels = playerDuelsRequest.all({userId: message.author.id});

            if (playerDuels === undefined || playerDuels.length == 0) {
                message.channel.send('Il n\'y a aucun duel en cours');
                return;
            }
            formattedDuelLists = 'Duels en cours:';
            playerDuels.forEach((duel) => {
                formattedDuelLists += '\n<@' + duel.defyingPlayer + '> VS <@' + duel.defiedPlayer + '>';
            });
            message.channel.send(formattedDuelLists);
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
        } catch (err) {
            console.log(err);
        }
    }

    //------------------------------------------------------------
    //-----       FORCE WEEKLY UPDATE ADMIN COMMAND         ------
    //------------------------------------------------------------
    this.AdminCommandForceWeeklyUpdate = function(message) {
        helperFunctions.DoWeeklyUpdate(message.channel);
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
client.on('messageReactionAdd', (messageReaction, user) => {

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

    if (result == undefined) return;

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
            console.log('Error: ' + err);
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
    console.log('Bot is ready');
});

client.login(process.env.DISCCORD_TOKEN);
