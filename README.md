# DBcord

A relational database stored as Discord messages.

## WHY???

Why not?

## How?

Metal and magic.

## I mean, how do I actually use this monstrosity?

The main code is in utilities/db.js. Feel free to copy that over to your own bot project. Along with all the files it depends on. Hurrah.

Or, you can run this whole thing as-is using the following process:

1. `git clone`
2. `npm install`
3. `echo 'module.exports = "blahblahblahtoken.token.supersecret";' > token.js`

You'll want to comment out the line `db.connect("565467535881797647")` in index.js for the moment.

4. `node index.js`
5. `bot.createServer("name", "region")`

Copy the ID from the response and insert it back into the line you commented out earlier. Reinstate that line.

(Or you could just use the ID of a server that you and the bot are already in, but *pssshshhhh.*)

### Other cool stuff

- local cache, only fetch more into cache when needed
- listen for changes by other users and update cache to match

## What features are planned?

- indexing
- 200% more epic
- I probably forgot something SUPER important so open an issue

## Database API

### Database

Create a new database. Each database manages one guild.  
`new dbcord.class()` → (db instance)

Link the database to a guild.  
`db.connect(guildID)` → void

Read column names and use them in subsequent queries.  
`db.registerNames(channelResolvable)` → Promise: void

Register an index.  
`db.registerIndex(channelResolvable)` → (index instance)

Create or update column names for a table.  
`db.schema(channelResolvable, data [, into])` → Promise: Row

Fetch all the messages in the channel for instant retrieval of all data without needing an index.  
`db.fetchChannel(channelResolvable)` → Promise: void

Insert data into the database. (Crud)  
`db.add(channelResolvable, data)` → Promise: Row

Get data from the database. (cRud)  
`db.get(channelResolvable, options)` → Promise: Array: Row // Promise: Row // Promise: Array: value // Promise: value

Edit data in the database. (crUd)  
`db.update(channelResolvable, options, slice, data)` → Promise: Array: Row

Delete data from the database. (cruD)  
`db.delete(channelResolvable, options)` → Promise: void

Execute an advanced SQL-like query.  
`db.query(channelResolvably, queryString)` → Promise: any

### Index

Prepare the index for use.  
`index.setup()` → Promise: self

Delete the existing index and create a new one using the data in the channel. This can be used to fix inconsistencies in the index.  
`index.regenerate()` → Promise: Array: Message

The index will otherwise manage itself when the database it is linked to is modified.

## Shoutouts

- [GPLv3® FreeSoftware™](https://en.wikipedia.org/wiki/Freeware)
- [despacito](https://youtu.be/dQw4w9WgXcQ)
- [powercord](https://powercord.dev/)
- [amanda](https://discord-bots.ga/amanda)