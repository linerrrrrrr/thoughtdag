# Memory: dossiers, your profile, and recall

ThoughtDAG's memory is a set of documents you can read, not a store you have to trust. Everything you discussed with Pi, Codex, Claude Code and DeepSeek Harness on this machine is indexed together; a decision model labels each turn by topic; one dossier per topic is written from those turns and kept up to date; when you ask, the dossiers that bear on the question ride in with it.

Open it from the ⋯ menu → **Memory**. The page has four parts.

## Settings

- **Recall past conversations when asking.** Before a question is sent, ThoughtDAG finds the dossiers and conversations that bear on it and brings them into the context. The switch on each node (the clock icon beside the send button) turns it off for that ask.
- **Update memory from conversations.** After an answer, a decision decides whether something durable was said and writes it into *you* or into the project's dossier. Every write leaves a changelog line and a toast with undo.
- **Decision model and amount.** Set up the decision model under **Settings → Decision model**. Use the recall control beside the question to choose how much context to bring in. See [Connect a decision model](/setup#decision-model).

## You

Two documents. **Preferences** is how you like things done: language, style, format, tools. **Identity** is who you are: role, field, long-term agenda. When the model records something new, it rewrites the line it refines or contradicts (the newest observation wins) rather than appending; the document keeps a changelog. You can edit either by hand. Both ride into every ordinary generation as the `[Memory]` block.

Memory entries from versions before 0.5 fold into these two documents on first use: preferences and identity by category, project facts into the inbox below. The original list is kept in the app's storage.

## Projects

One row per topic. A topic is a short name and one sentence saying what belongs in it; **Edit topics…** opens the table, lets the model propose topics from your past questions, and runs the labelling: a decision model answers, for every indexed turn, one yes/no per topic. Labelling runs in the background, six hundred turns per click, with progress and errors shown.

Open a row to see its **dossier**:

| Section | What it holds |
|---|---|
| What it is | Two to four sentences |
| Decisions taken | Choices made, newest last; a reversed decision keeps one line saying what replaced what |
| Where it stands | The latest state; the newest turn wins |
| Still open | Questions left unresolved |

Every sentence carries source chips; a chip opens the turn it came from. **Build dossier** has the model read the topic's newest hundred turns and write it. When the topic gains conversations, the row shows *N new turns* and **Update dossier** reads only those; facts the memory judge filed for the topic are merged at the same time, and a dossier merges by itself once six of them wait. **Rebuild from conversations** starts over. Each section can be edited by hand; the changelog records what changed.

Project facts no topic claimed wait in the **inbox** under the list: file one to a topic, or discard it.

## Sources

The local conversation index (how many turns it holds) and the memory files other agents keep for themselves on this machine, read-only. Those files are indexed too, so search and recall reach them.

## Search

The box at the top searches dossiers, conversations and the other agents' memory files in one go. A topic named by the phrase shows its dossier first; hits are grouped by conversation, one line per conversation saying what it was about, the turns unfolding underneath. Every turn can be opened in its mirror or cited onto the canvas as a note wired into the selected node.

## Recall, on a node

With recall on, an ask does this before sending:

1. Decide which topics the question is about (the decision model, or a topic named in the question).
2. Bring those dossiers in whole, at most two.
3. Decide whether the question asks for a specific detail. If it does, or if no dossier applies, search the index by the question's words, rank the candidates by relevance and bring the best in within the amount.

The panel's **Recall** section says in one line what came in, lists a card per item with its cost, and lets you strike any; the verbatim text is one click away. **How it was chosen** folds the numbers: topics, the detail decision, candidates, what was held back (one click brings it), the amount used. **Bring a few more** adds the next candidates.

**Related conversations**, below it, finds past conversations related to the node on demand: the node's terms as chips, the decision model's pick of topics, one button to let the model expand the query, and cards with open and cite.

## Amount

Recall works within a ceiling on input tokens: **lean** 4k (a dossier and five to eight excerpts), **standard** 12k, **generous** 40k (everything the decision model finds relevant). A small context window caps at two fifths of itself. Choose the amount in the question’s recall menu.

## Where it lives

The index, topic labels and dossiers are files under `~/.thoughtdag`, shared by the desktop app and the DeepSeek Harness plugin. Your profile documents live in the app's own storage. A decision sends only the question and the candidate excerpts to the access you chose; with the decision model off, nothing is sent and every decision falls back to a rule.

From the command line, `thoughtdag topics` prints the topic table and how much of the index carries labels; `thoughtdag topics --of <id>` lists a topic's turns.
