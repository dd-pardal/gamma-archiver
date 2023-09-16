# Gamma Archiver

> [!NOTE]
> This project isn’t dead. I’ve been reworking the thread synchronization algorithm so it can handle an arbitrarily big number of threads (which is a lot of work) and I don’t have much time to work on this due to my work as a student.

> [!IMPORTANT]
> This project is experimental and incomplete. While it works well right now, there are many features missing and many things, including the database format and the name of the project, may change.

## <!-- OwO --> What’s this?

Gamma Archiver is a program that archives data from Discord, including users, members, servers, roles, channels, threads and messages (called “objects” from now on). It’s designed to handle large amounts of data and can use multiple accounts at the same time.

The archiver can archive already-created objects (e.g. message history) and also new objects as soon as they’re created. It archives past messages from multiple channels concurrently, allowing it to easily archive thousands of messages per second if there are enough channels, up to a theoretical maximum of 5000 messages per account per second. It records all changes to objects, allowing you to see how any server looked like at any point in time. Information is never deleted from the database, so past versions of objects and deleted objects are still viewable.

## Use cases

- **Backup:** Many people have somewhat valuable information stored on Discord. This information can become inaccessible if the server gets raided or deleted by Discord, or if Discord is unavailable for some reason.
- **Better searching:** Having a local copy allows you to search through the data in any way you want. For example, you can search for attachments with a specific file extension. (This is not currently implemented in ths search program.)
- **Server moderation:** Being able to see all of what members do can help you take appropriate actions.
- **Offline use:** If society as we know it falls and you lose access to the Internet, having an archive will allow you to relive the good old times with your Discord friends.

## Installation

1. Install Node.js (version 16, 18 or ≥20) and npm
2. Either:
   - Download [this repo’s files](https://github.com/dd-pardal/gamma-archiver/archive/refs/heads/main.zip) and extract them, or
   - Install Git and run `git clone --depth 1 https://github.com/dd-pardal/gamma-archiver.git`
3. Open a command prompt / terminal in the directory with the files.
4. Run
   ```sh
   npm install && npm run build
   ```

## Archiving

The archiver requests data from Discord and writes it into the database. The database file will be created if it doesn’t exist.

By default, the archiver archives data from every place every account has access to. This includes all messages from all channels for which at least one account has permission to view the messages. You can currently restrict archiving to specific servers using the `--guild` option. The archiver will connect to Discord and record all of the data Discord sends in realtime. This includes new messages, for example. Additionally, unless `--no-sync` is used, it will also request past messages, archived threads and guild members.

Usage:

```
node ./build/archiver/index.js --token <token> [--log (error | warning | info | verbose | debug)] [--stats (yes | no | auto)] [(--guild <guild id>)…] [--no-sync] [--no-reactions] <database path>
```

Options:

- `--token <token>`: Sets the Discord bot tokens, prefixed by the token type (`Bot`). The bots must have the message content and server members intents enabled. You can specify this option more than once to use multiple accounts at the same time to archive content.
- `--log <level>`: Sets the max logging level. See logging section below.
- `--stats (yes | no | auto)`: Enables/disables showing sync statistics.
  - `yes`: Always output statistics to standard output
  - `no`: Never output statistics to standard output
  - `auto`: Output statistics to standard output if it is connected to a terminal/console
- `--guild <guild id>`: Restricts archiving to specific servers. You can specify this option more than once to archive more than one servers. If this option is missing, all available servers will be archived. Currently, this option only prevents the program from actively requesting information about other guilds (syncing). Information passively sent by Discord via the gateway (realtime archiving) is still stored.
- `--no-sync`: Prevents requesting past messages, archived threads and guild members.
- `--no-reactions`: Prevents archiving who reacted to messages. Reaction counts won’t be archived.

Example:

```sh
node ./build/archiver/index.js --token "Bot abc.def.ghi" --log verbose --guild 123456789 --guild 987654321 archive.gar
```

### Logging

All logs are sent to standard error. There are 5 logging levels:

- `error`: unexpected events requiring immediate user attention
- `warning`: events that can cause problems (i.e. events that cause the database to become out of sync)
- `info`: relevant informative messages
- `verbose`: less relevant informative messages
- `debug`: most data sent to and received from Discord and all operations performed on the database; rarely useful except for debugging the archiver

You can set the maximum level using the `--log` option. For example, `--log verbose` makes the program will log all `error`, `warning`, `info` and `verbose` messages, but not `debug` ones. The default maximum level is `info`, which is rather quiet. If you want to see what the archiver is doing, use `--log verbose`.

## Searching

There’s also a program that allows you to search messages in the database. You can use it both while the archiver is running and when it is not.

Usage:

```
node ./build/search.js <database path>
```

The search program uses the SQLite FTS5 extension. This allows for very fast querying but you can’t search for arbitrary substrings, only sets of words. You must use the [SQLite FTS5 syntax](https://www.sqlite.org/fts5.html#full_text_query_syntax) in your queries.

Query examples:

- `alpha beta`: messages that contain the word “alpha” and the word “beta”
- `"alpha beta"`: messages that contain the expression “alpha beta”
- `alpha OR beta`: messages that contain the word “alpha” or the word “beta” or both
- `lov*`: messages that contain a word that starts with “lov” (love, loving, loved, lovely, etc.)

## Extracting data from the database

You can read the raw data from the database using the SQLite CLI or any SQLite database viewer such as [sqliteviewer.app](https://sqliteviewer.app/). Every time the archiver archives an object for the first time or detects a change in an already-stored object, it records a snapshot of the object to the database. The snapshots are identified by the timestamp at which the data was retrieved from Discord. Check the `schema.sql` file for more info about the database format.

## Current to-do list

- [x] Archiver
  - [ ] Proper configuration system
    - [ ] Account credentials
    - [ ] Inheritance-based filtering system to restrict archiving
  - [ ] User account support
    - [ ] Import user account settings from HAR
  - [x] Servers
    - [x] Server channels
    - [x] Roles
    - [ ] Custom emojis
  - [ ] DM channels
  - [x] Messages
    - [x] From text/announcement channels
    - [x] From voice channels
    - [x] From forum channels
    - [x] Attachments
      - [ ] Download attachments
    - [x] Reactions
  - [ ] Export all data to plaintext
  - [ ] Allow thread enumeration to be interrupted
  - [ ] Fix switching accounts on permission changes (or remove multi-account support)
  - [ ] Import data from HAR
  - [ ] Export data to DCE format
  - [ ] Import data from DCE format
  - [ ] Archive private threads without manage permission
  - [ ] Option to archive newer messages first
  - [ ] Restart without reidentifying
  - [ ] Add/update/remove accounts while running
  - [ ] Voice chat archiving?
- [ ] Database browser (**help appreciated, please open an issue if you want to help**)
- [x] Basic message search CLI
  - [x] Fast search using FTS5 index
    - [ ] Include embeds in FTS5 index
  - [ ] Search using regular expressions

## Copyright and disclaimers

Copyright © D. Pardal

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, version 3.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this program. (Look for a file named `LICENSE.txt`.) If not, see <https://www.gnu.org/licenses/>. 
