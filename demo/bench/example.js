const {schema, doc, p, ol, ul, li, h1, h2, blockquote, em, code, a} = require("prosemirror-model/test/build")

exports.schema = schema

let example = doc(
  h1("Collaborative Editing in ProseMirror"),
  p("This post describes the algorithm used to make collaborative editing work in ", a("ProseMirror"), ". For an introduction to ProseMirror, see ", a("another post"), " here."),
  h2("The Problem"),
  p("A real-time collaborative editing system is one where multiple people may work on a document at the same time. The system ensures that the documents stay synchronized—changes made by individual users are sent to other users, and show up in their representation of the document."),
  p("Since transmitting changes over any kind of network is going to take time, the complexity of such systems lies in the way they handle concurrent updates. One solution is to allow users to lock the document (or parts of it) and thus prevent concurrent changes from happening at all. But this forces users to think about locks, and to wait when the lock they need is not available. We'd prefer not to do that."),
  p("If we allow concurrent updates, we get situations where user A and user B both did something, unaware of the other user's actions, and now those things they did have to be reconciled. The actions might not interact at all—when they are editing different parts of the document—or interact very much—when they are trying to change the same word."),
  h2("Operational Transformation"),
  p("A lot of research has gone into this problem. And I must admit that, though I did read a bunch of papers, I definitely do not have a deep knowledge of this research, and if you find that I misrepresent something or am missing an interesting reference, I am very interested in an ", a("email"), " that tells me about it."),
  p("A lot of this research is about truly distributed systems, where a group of nodes exchange messages among themselves, without a central point of control. The classical approach to the problem, which is called ", a("Operational Transformation"), ", is such a distributed algorithm. It defines a way to describe changes that has two properties:"),
  ol(li(p("You can transform changes relative to other changes. So if user A inserted an “O” at offset 1, and user B concurrently inserted a “T” at offset 10, user A can transform B's change relative to its own change, an insert the “T” at offset 11, because an extra character was added in front of the change's offset.")),
     li(p("No matter in which order concurrent changes are applied, you end up with the same document. This allows A to transform B's change relative to its own change, and B to transform A's change similarly, without the two users ending up with different documents."))),
  p("An Operational Transformation (OT) based system applies local changes to the local document immediately, and broadcasts them to other users. Those users will transform and apply them when they get them. In order to know exactly which local changes a remote change should be transformed through, such a system also has to send along some representation of the state of the document at the time the change was made."),
  p("That sounds relatively simple. But it is a nightmare to implement. Once you support more than a few trivial types of changes (things like “insert” and “delete”), ensuring that applying changes in any order produces the same document becomes very hard."),
  p("Joseph Gentle, one of the engineers who worked on Google Wave, ", a("stated"), "..."), blockquote(p("Unfortunately, implementing OT sucks. There's a million algorithms with different trade-offs, mostly trapped in academic papers. The algorithms are really hard and time consuming to implement correctly.")),
  h2("Centralization"),
  p("The design decisions that make the OT mechanism complex largely stem from the need to have it be truly distributed. Distributed systems have nice properties, both practically and politically, and they tend to be interesting to work on."),
  p("But you can save oh so much complexity by introducing a central point. I am, to be honest, extremely bewildered by Google's decision to use OT for their Google Docs—a centralized system."),
  p("ProseMirror's algorithm is centralized, in that it has a single node (that all users are connected to) making decisions about the order in which changes are applied. This makes it relatively easy to implement and to reason about."),
  p("And I don't actually believe that this property represents a huge barrier to actually running the algorithm in a distributed way. Instead of a central server calling the shots, you could use a consensus algorithm like ", a("Raft"), " to pick an arbiter. (But note that I have not actually tried this.)"),
  h2("The Algorithm"),
  p("Like OT, ProseMirror uses a change-based vocabulary and transforms changes relative to each other. Unlike OT, it does not try to guarantee that applying changes in a different order will produce the same document."),
  p("By using a central server, it is possible—easy even—to have clients all apply changes in the same order. You can use a mechanism much like the one used in code versioning systems. When a client has made a change, they try to ", em("push"), " that change to the server. If the change was based on the version of the document that the server considers current, it goes through. If not, the client must ", em("pull"), " the changes that have been made by others in the meantime, and ", em("rebase"), " their own changes on top of them, before retrying the push."),
  p("Unlike in git, the history of the document is linear in this model, and a given version of the document can simply be denoted by an integer."),
  p("Also unlike git, all clients are constantly pulling (or, in a push model, listening for) new changes to the document, and track the server's state as quickly as the network allows."),
  p("The only hard part is rebasing changes on top of others. This is very similar to the transforming that OT does. But it is done with the client's ", em("own"), " changes, not remote changes."),
  p("Because applying changes in a different order might create a different document, rebasing isn't quite as easy as transforming all of our own changes through all of the remotely made changes."),
  h2("Position Mapping"),
  p("Whereas OT transforms changes relative to ", em("other changes"), ", ProseMirror transforms them using a derived data structure called a ", em("position map"), ". Whenever you apply a change to a document, you get a new document and such a map, which you can use to convert positions in the old document to corresponding positions in the new document. The most obvious use case of such a map is adjusting the cursor position so that it stays in the same conceptual place—if a character was inserted before it, it should move forward along with the surrounding text."),
  p("Transforming changes is done entirely in terms of mapping positions. This is nice—it means that we don't have to write change-type-specific transformation code. Each change has one to three positions associated with it, labeled ", code("from"), ", ", code("to"), ", and ", code("at"), ". When transforming the change relative to a given other change, those positions get mapped through the other change's position map."),
  p("For example, if a character is inserted at position 5, the change “delete from 10 to 14” would become “delete from 11 to 15” when transformed relative to that insertion."),
  p("Every change's positions are meaningful only in the exact document version that it was originally applied to. A position map defines a mapping between positions in the two document versions before and after a change. To be able to apply a change to a different version, it has to be mapped, step by step, through the changes that lie between its own version and the target version."),
  p("(For simplicity, examples will use integers for positions. Actual positions in ProseMirror consist of an integer offset in a paragraph plus the path of that paragraph in the document tree.)"),
  h2("Rebasing Positions"),
  p("An interesting case comes up when a client has multiple unpushed changes buffered. If changes from a peer come in, all of the locally buffered changes have to be moved on top of those changes. Say we have local changes ", em("L1"), " and ", em("L2"), ", and are rebasing them onto remote changes ", em("R1"), " and ", em("R2"), ", where ", em("L1"), " and ", em("R1"), " start from the same version of the document."),
  p("First, we apply R1 and R2 to our representation of that original version (clients must track both the document version they are currently displaying, which includes unsent changes, and the version that does not yet include those changes). This creates two position maps ", em("mR1"), " and ", em("mR2"), "."),
  p("We can simply map ", em("L1"), " forward through those maps to arrive at ", em("L1⋆"), ", the remapped version of ", em("L1"), ". But ", em("L2"), " was based on the document that existed after applying ", em("L1"), ", so we first have to map it ", em("backwards"), " through ", em("mL1"), ", the original map created by applying ", em("L1"), ". Now it refers to the same version that ", em("R1"), " starts in, so we can map it forward through ", em("mR1"), " and ", em("mR2"), ", and then finally though ", em("mL1⋆"), ", the map created by applying ", em("L1⋆"), ". Now we have ", em("L2⋆"), ", and can apply it to the output of applying ", em("L1⋆"), ", and ", em("voila"), ", we have rebased two changes onto two other changes."),
  p("Except that mapping through deletions or backwards through insertions loses information. If you insert two characters at position 5, and then another one at position 6 (between the two previously inserted characters), mapping backwards and then forward again through the first insertion will leave you before or after the characters, because the position between them could not be expressed in the coordinate space of a document that did not yet have these characters."),
  p("To fix this, the system uses mapping pipelines that are not just a series of maps, but also keep information about which of those maps are mirror images of each other. When a position going through such a pipeline encounters a map that deletes the content around the position, the system scans ahead in the pipeline looking for a mirror images of that map. If such a map is found, we skip forward to it, and restore the position in the content that is inserted by this map, using the relative offset that the position had in the deleted content. A mirror image of a map that deletes content must insert content with the same shape."),
  h2("Mapping Bias"),
  p("Whenever content gets inserted, a position at the exact insertion point can be meaningfully mapped to two different positions: before the inserted content, or after it. Sometimes the first is appropriate, sometimes the second. The system allows code that maps a position to choose what bias it prefers."),
  p("This is also why the positions associated with a change are labeled. If a change with ", code("from"), " and ", code("to"), " positions, such as deleting or styling a piece of the document, has content inserted directly before or after it, that content should not be included in the change. So ", code("from"), " positions get mapped with a forward bias, and ", code("to"), " positions with a backward bias."),
  p("When a change is mapped through a map that completely contains it, for example when inserting a character at position 5 is mapped through the map created by deleting from position 2 to 10, the whole change is simply dropped, since the context in which it was made no longer exists."),
  h2("Types of Changes"),
  p("An atomic change in ProseMirror is called a ", em("step"), ". Some things that look like single changes from a user interface perspective are actually decomposed into several steps. For example, if you select text and press enter, the editor will generate a ", em("delete"), " step that removes the selected text, and then a ", em("split"), " step that splits the current paragraph."),
  p("These are the step types that exist in ProseMirror:"),
  ul(li(p("", code("addStyle"), " and ", code("removeStyle"), " add and remove inline styling to or from a piece of the document. They take ", code("from"), " and ", code("to"), " positions.")),
     li(p("", code("split"), " splits a node in two. It can be used, for example, to split a paragraph when the user presses enter. It takes a single ", code("at"), " position.")),
     li(p("", code("join"), " joins two adjacent nodes. This only works if they contain the same type of content. It takes ", code("from"), " and ", code("to"), " positions that should refer to the end and start of the nodes to be joined. (This is to make sure that the nodes that were actually intended are being joined. The step is ignored when another node has been inserted between them in the meantime.)")),
     li(p("", code("ancestor"), " is used to change the type of a node and to add or remove nodes above it. It can be used to wrap something in a list, or to convert from a paragraph to a heading. It takes ", code("from"), " and ", code("to"), " positions pointing at the start and end of the node.")),
     li(p("", code("replace"), " replaces a piece of the document with zero or more replacement nodes, and optionally stitches up compatible nodes at the edges of the cut. Its ", code("from"), " and ", code("to"), " positions define the range that should be deleted, and its ", code("at"), " position gives the place where the new nodes should be inserted."))),
  p("The last type is more complex than the other ones, and my initial impulse was to split it up into steps that remove and insert content. But because the position map created by a replace step needs to treat the step as atomic (positions have to be pushed out of ", em("all"), " replaced content), I got better results with making it a single step."),
  h2("Intention"),
  p("An essential property of real-time collaborative systems is that they try to preserve the ", em("intention"), " of a change. Because “merging” of changes happens automatically, without user interaction, it would get very annoying when the changes you make are, through rebasing, reinterpreted in a way that does not match what you were trying to do."),
  p("I've tried to define the steps and the way in which they are rebased in so that rebasing yields unsurprising behavior. Most of the time, changes don't overlap, and thus don't really interact. But when they overlap, we must make sure that their combined effect remains sane."),
  p("Sometimes a change must simply be dropped. When you type into a paragraph, but another user deleted that paragraph before your change goes through, the context in which your input made sense is gone, and inserting it in the place where the paragraph used to be would create a meaningless fragment."),
  p("If you tried to join two lists together, but somebody has added a paragraph between them, your change becomes impossible to execute (you can't join nodes that aren't adjacent), so it is dropped."),
  p("In other cases, a change is modified but stays meaningful. If you made characters 5 to 10 strong, and another user inserted a character at position 7, you end up making characters 5 to 11 strong."),
  p("And finally, some changes can overlap without interacting. If you make a word a link and another user makes it emphasized, both of your changes to that same word can happen in their original form."),
  h2("Offline Work"),
  p("Silently reinterpreting or dropping changes is fine for real-time collaboration, where the feedback is more or less immediate—you see the paragraph that you were editing vanish, and thus know that someone deleted it, and your changes are gone."),
  p("For doing offline work (where you keep editing when not connected) or for a branching type of work flow, where you do a bunch of work and ", em("then"), " merge it with whatever other people have done in the meantime, the model I described here is useless (as is OT). It might silently throw away a lot of work (if its context was deleted), or create a strange mishmash of text when two people edited the same sentence in different ways."),
  p("In cases like this, I think a diff-based approach is more appropriate. You probably can't do automatic merging—you have to identify conflicts had present them to the user to resolve. I.e. you'd do what git does."),
  h2("Undo History"),
  p("How should the undo history work in a collaborative system? The widely accepted answer to that question is that it definitely should ", em("not"), " use a single, shared history. If you undo, the last edit that ", em("you"), " made should be undone, not the last edit in the document."),
  p("This means that the easy way to implement history, which is to simply roll back to a previous state, does not work. The state that is created by undoing your change, if other people's changes have come in after it, is a new one, not seen before."),
  p("To be able to implement this, I had to define changes (steps) in such a way that they can be inverted, producing a new step that represents the change that cancels out the original step."),
  p("ProseMirror's undo history accumulates inverted steps, and also keeps track of all position maps between them and the current document version. These are needed to be able to map the inverted steps to the current document version."),
  p("A downside of this is that if a user has made a change but is now idle while other people are editing the document, the position maps needed to move this user's change to the current document version pile up without bound. To address this, the history periodically ", em("compacts"), " itself, mapping the inverted changes forward so that they start at the current document again. It can then discard the intermediate position maps.")
)
exports.example = example