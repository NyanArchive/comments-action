import { debug, info, isDebug, setFailed } from "@actions/core"
import { context, getOctokit } from "@actions/github"
import differ from "@adryd325/discord-datamining-lang-differ"
import type { PushEvent } from "@octokit/webhooks-types"

const token = process.env.GITHUB_TOKEN
const filePathRegex = /\/\d{4}\/(?:\d{4}-\d{2}-\d{2}|\d{2}\/\d{2})\/[a-z0-9]{20,}\.js$/
const currentFilename = "current.js"

async function run() {
    try {
        if (!token) return setFailed("Invalid GITHUB_TOKEN")

        const octokit = getOctokit(token)
        const { owner, repo } = context.repo

        if (context.eventName !== "push") return

        const payload = context.payload as PushEvent
        const commitSha = payload.after

        const commit = await octokit.rest.repos.getCommit({
            owner,
            repo,
            ref: commitSha
        })

        if (!commit)
            return setFailed("commit not found")

        const commitFile = commit.data.files?.[0]

        if (!commitFile || commitFile?.status !== "added")
            return info("not a build commit")

        const { blob_url, sha: fileSha } = commit?.data?.files?.[0]

        if (!filePathRegex?.test(decodeURIComponent(blob_url)))
            return info("not a build file")

        const currentTree = await octokit.rest.git.getTree({
            owner,
            repo,
            tree_sha: payload.before,
        })
        const currentFileSha = currentTree?.data?.tree?.find?.(file => file.path === currentFilename)?.sha

        if (!currentFileSha)
            return info("no current file")

        const currentFile = await octokit.rest.git.getBlob({
            owner,
            repo,
            file_sha: currentFileSha
        })
        const newFile = await octokit.rest.git.getBlob({
            owner,
            repo,
            file_sha: fileSha,
        })

        const currentContent = Buffer.from(currentFile.data.content, "base64").toString("utf8")
        const newContent = Buffer.from(newFile.data.content, "base64").toString("utf8")
        if (isDebug()) {
            debug(`${currentContent.length}`)
            debug(`${newContent.length}`)
        }

        let diff: string
        try {
            diff = differ(
                currentContent,
                newContent,
                "codeblock",
            )
        } catch (e) {
            return setFailed(`unable to diff strings: ${e}`)
        }

        if (!diff)
            return info("no strings changed")

        await octokit.rest.repos.createCommitComment({
            owner,
            repo,
            commit_sha: commitSha,
            body: diff
        })
        return info("created commit comment")
    } catch (error) {
        setFailed(isDebug() ? error.stack : error.message)
    }
}
run()
