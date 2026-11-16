---
title: "How to bring past AI discussions into a new question"
description: "Find supported local AI conversations, check their original constraints, and cite selected material in a new question with ThoughtDAG."
---

# How to bring past AI discussions into a new question

When reading a new paper, you might remember an alternative method you previously discussed with an AI but ultimately abandoned. You recall dropping it because it was "too slow," but you can't remember if the bottleneck was the algorithm, the hardware, or the deployment setup. If you just pass the vague conclusion "it was too slow, skip it" into your new prompt, you risk missing the actual constraints from that time.

ThoughtDAG is an open-source AI conversation canvas that can retrieve supported local agent discussions. This guide walks through finding, checking, and citing earlier thinking in a new question.

## Prep: Ensure the past discussion is local

Use the ThoughtDAG desktop version, which has access to the local index, and ensure a model is configured to answer questions. The past discussion needs to be stored in a supported local source; chat histories that exist solely in a web-based account will not automatically appear here.


<TutorialMedia clip="history" alt="Illustration: connect a new paper with earlier judgments, constraints, and follow-up questions" />

Illustration: a new paper makes earlier judgments and constraints useful again. This is a fictional example; follow the steps below to search, inspect sources, and cite selected material.

## 1. Find related history next to your new question

Return to the canvas where you want to work. This guide uses manual references: turn **Recall** off before creating a new question node to revisit the earlier method. If you use an existing node, check its recall items and materials as well.

Double-click the question node and expand **Related conversations**. Try a method name, filename, or a phrase such as “run locally” that appeared in the earlier discussion. Basic term search depends on exact wording, so “that old idea” may find nothing.

Seeing a search result does not add it to the current canvas context. If you find nothing, check the sources and index, then try more specific wording. With a configured decision model, **Let the model expand** can suggest more search terms. You do not need it for manual citation.

## 2. Review the original text and constraints

Open the hit from the source list and read the relevant conversation turns: what exactly caused you to rule out the method back then? Which conditions might have changed by now? Do not treat a past conclusion as absolute truth today based solely on a brief summary.

Opening a canvas source switches to its node. An Agent source opens in its own runtime when available. After verifying the details, return to the original canvas and re-select the question node before citing.

## 3. Cite the useful parts and continue

Click **Cite** on the result you want. With a target node selected, this creates a material node with source information and wires it into that target. Without a selected target, the material is placed on the canvas; connect it where you want to use it.

Read the cited material. Long turns may be truncated; an ellipsis means you may need to return to the source and supply missing context. Remove irrelevant parts while keeping the conditions needed for your judgment. If a condition has changed, explain the change rather than silently presenting an edited statement as the original. Then check the target node’s incoming connections and attachments.

Adding a reference does not rewrite an existing answer. Regenerate it, or continue with a follow-up: “We abandoned this route due to compute costs. Considering the method in this new paper, which constraints might improve, and which still need verification?”

You can also branch from the same question to ask, “Can this run locally?”

## Boundaries and Limitations

Any edits you make on the canvas do not rewrite the original log files of the source Agent. The index only covers local records that have been connected and parsed; it cannot restore history that was never saved.

If you enable **Recall**, it can also retrieve and add history when you send. The recall section shows the items used. After excluding an item, regenerate the answer; this does not retract an earlier request.

When using a remote model, material included in the request is sent to the configured model service. A local index does not make the whole conversation offline.

Your past discussions now have a traceable entry point, allowing you to evaluate which historical conditions still hold true before deciding which direction to explore next.

---

Related guides: [Getting started](/) · [Context controls](/guides/context-control) · [Conversations and branches](/guides/conversations)
