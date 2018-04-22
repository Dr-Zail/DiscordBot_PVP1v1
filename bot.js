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

//For most of the commands, player must already be registered, check DB to make sure he is
async function IsPlayerRegistered(message)
{
	try {
		var playerExists = await db.get('SELECT * FROM Players WHERE userId = ?', [message.author.id], function(err, row) {
			if (err)
			{
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


//The class that contain all the command function
//All function are associated to a "functionName" value defined in the JSON corresponding file
var CommandClass = function() {

	//------------------------------------------------------------
	//----- 				HELP COMMAND					------
	//------------------------------------------------------------
	this.CommandHelp = function(message)
	{
		message.channel.send('help');
	};

	//------------------------------------------------------------
	//----- 				REGISTER COMMAND				------
	//------------------------------------------------------------
	this.CommandRegister = function(message)
	{
		try {
			db.run('INSERT INTO Players (userId) VALUES (?)', [message.author.id], function(err) {
				if (err)
				{
					if (err.code == 'SQLITE_CONSTRAINT')
						message.channel.send(message.author+ ' deja inscris');
					else
						console.log(err);
				}
				else
					message.channel.send(message.author + ' inscris pour les duels !');
			});
		} catch (err) {
			console.log(err);
		}
	}

	//------------------------------------------------------------
	//----- 				CHALLENGE COMMAND				------
	//------------------------------------------------------------
	this.CommandChallenge = function(message)
	{
		//At least 1 user mention
		if (message.mentions.users.size != 1) return;
		//Cannot challenge self or bots ;)
		// if (message.mentions.users.array()[0].id === message.author.id || message.mentions.users.array()[0].id.bot) return;

		if (!IsPlayerRegistered(message))
		{
			message.channel.send('Il faut etre inscris pour declarer un duel (' +  message.author + ')');
			return;
		}

		try {
			//Check last duel declaration was at least 24h ago
			db.get('SELECT lastDuelDeclarationTime FROM Players WHERE userId = ?', [message.author.id], function(err, row) {
				if (row != undefined)
				{
					console.log('lastDuelDeclarationTime: '  + row.lastDuelDeclarationTime);
					var declDate = moment(row.lastDuelDeclarationTime, 'YYYY-MM-DD HH:mm:ss');
					var diff = moment().diff(declDate,'minutes');

					if (diff < options.hoursBeforeChallenge * 60)
					{
						message.channel.send('Impossible de declarer un duel, derniere declaration de duel par ' +  message.author + ' ete il y a moins de ' + options.hoursBeforeChallenge  + ' heures (' +  row.lastDuelDeclarationTime + ')');
						return;
					}
				}

				//Check player rank and division against challenged player
				db.all('SELECT rank, division FROM Players WHERE userId IN (?, ?)', [message.author.id, message.mentions.users.array()[0].id], function(err, row) {
                    if (err)
                    {
                        console.log(err);
                        return;
                    }

                    //Not enough players info found (someone may not be registered)
                    //Should not happen because
                    if (row.length < 2)
                    {
                        console.log(err);
                        return;
                    }
                    console.log(row);
                    console.log('Player1 rank: ' + row[0].rank + ' division: ' + row[0].division);
                    console.log('Player1 rank: ' + row[1].rank + ' division: ' + row[1].division);

                    db.beginTransaction(function(err, transaction) {
                        transaction.run('INSERT INTO OnGoingDuels(defyingPlayer, defiedPlayer, declarationTime) VALUES(?, ?, ?)',
                        [message.author.id, message.mentions.users.array()[0].id, moment().format('YYYY-MM-DD HH:mm:ss')]);

                        transaction.run('UPDATE Players SET lastDuelDeclarationTime = (?) WHERE userId = ?',
                        [ moment().format('YYYY-MM-DD HH:mm:ss'), message.author.id]);

                        transaction.commit(function(err) {
                            if (err)
                                return console.log(err);
                            else
                                message.channel.send('Duel lance entre ' + message.author + ' et ' + message.mentions.users.array()[0]);
                        });
                    });
				});
			});
		} catch (err) {
			console.log(err);
		}
	}

	//------------------------------------------------------------
	//----- 				RESULT COMMAND					------
	//------------------------------------------------------------
	this.CommandResult = function(message)
	{
		//Nothing to do here, all is done in the "messageReactionAdd" event
	}

	//------------------------------------------------------------
	//-----  		DISPLAY PLAYER LIST COMMAND				------
	//------------------------------------------------------------
	this.CommandDisplayPlayerList = function(message)
	{
		try {
			db.all('SELECT * FROM Players', function(err, rows) {
				console.log(err);

                console.log(util.inspect(rows));
                formattedPlayersLists = 'Joueurs:';

                rows.forEach((player) => {
                    formattedPlayersLists += '\n<@' +  player.userId + '>';
                });
                message.channel.send(formattedPlayersLists);
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
	this.AdminCommandRegister = function(message)
	{
		//At least 1 mention of a user
		if (message.mentions.users.size != 1) return;
		//Cannot register bots ;)
		// if (message.mentions.users.first().bot) return;

		try {
			db.run("INSERT INTO Players (userId) VALUES (?)", [message.mentions.users.array()[0].id], function(err) {
				if (err)
				{
					if (err.code ==='SQLITE_CONSTRAINT')
						message.channel.send(message.mentions.users.array()[0] + ' deja inscris');
					else
						console.log(err);
				}
				else
					message.channel.send(message.mentions.users.array()[0]+ ' inscris pour les duels !');
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
function ParseMessageAndExecuteCommand(message)
{
	//Test current message with all possible commands
	for (var commandIdx = 0; commandIdx <  commandsArray.length; ++commandIdx)
	{
		var commandSyntaxes = Object.values(commandsArray[commandIdx].syntaxNames);
		//console.log(options.commands[command]);
		for (var syntaxIdx = 0; syntaxIdx < commandSyntaxes.length; ++syntaxIdx)
		{
			if (message.content.lastIndexOf(commandSyntaxes[syntaxIdx], 0) === 0)
			{
				console.log('Function call: '  + commandsArray[commandIdx].functionName);
				commandsFunctions[commandsArray[commandIdx].functionName](message);
				return;
			}
		}
	}

	//Player sending message has "admin" rights
	//if (message.author.id == 'ADMIN')
	{
		for (var adminCommandIdx = 0; adminCommandIdx <  adminCommandsArray.length; ++adminCommandIdx)
		{
			var adminCommandSyntaxes = Object.values(adminCommandsArray[adminCommandIdx].syntaxNames);
			//console.log(options.commands[command]);
			for (var syntaxIdx = 0; syntaxIdx < adminCommandSyntaxes.length; ++syntaxIdx)
			{
				if (message.content.lastIndexOf(adminCommandSyntaxes[syntaxIdx], 0) === 0)
				{
					console.log('Function call: '  + adminCommandsArray[adminCommandIdx].functionName);
					commandsFunctions[adminCommandsArray[adminCommandIdx].functionName](message);
					return;
				}
			}
		}
	}

	//------------------------------------------------------------
	//----- 			Messages non traités 				------
	//------------------------------------------------------------
	if (message.content.lastIndexOf('!', 0) === 0)
	{
		var commandLength = message.content.indexOf(' ', 2);
		message.channel.send('Commande inconue: ' + message.content.substr(0, ( commandLength != -1 ? commandLength : message.content.length)));
		return;
	}
}

function IsExcludedMessage(message)
{
	//Exclude bot messages (usually self-send messages)
	if (message.author.bot)
		return true;
	//Exclude message sent on the wrong channel (in case the permissions are not correctly set)
	if (message.channel.type != 'text' || message.channel.name != options.channelName)
		return true;
}

client.on('message',  message => {
	if (IsExcludedMessage(message))
		return;

	console.log('message.content: ' + message.content);

	ParseMessageAndExecuteCommand(message);
});

//Callback on event messageReactionAdd to check result of a duel
client.on('messageReactionAdd', async  (messageReaction, user) => {

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
		db.run('INSERT INTO DuelsDone(winner, loser, resultTime) VALUES(?, ?, datetime(\'now\'))',
			[result[3], result[2] != result[3] ? result[2] : result[1]], function(err) {
				console.log(err);
		});
		messageReaction.message.channel.send('Resultat confirme pour le duel entre ' + result[1] + ' et ' + result[2] + ' Vainqueur: ' + result[3]);
	} catch (err) {
		console.log(err);
	}

});

//Verify JSON and commands functions
function VerifyJSONAndCommandClass()
{
	for (var commandIdx = 0; commandIdx <  commandsArray.length; ++commandIdx)
	{
		if (!commandsFunctions.hasOwnProperty(commandsArray[commandIdx].functionName))
			console.log('ERROR: Missing function [[  ' + commandsArray[commandIdx].functionName + '  ]] in the CommandClass');
	}
}

client.on("ready", () => {
	VerifyJSONAndCommandClass();
});

client.login(process.env.DISCCORD_TOKEN);
