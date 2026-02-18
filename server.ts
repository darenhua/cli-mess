import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const PROJECTS_DIR = join(import.meta.dir, ".projects");

Bun.serve({
    port: 3000,
    routes: {
        "/api/project/init": {
            POST: async (req) => {
                const { remoteUrl } = await req.json();

                if (!remoteUrl || typeof remoteUrl !== "string") {
                    return Response.json(
                        { error: "remoteUrl is required" },
                        { status: 400 }
                    );
                }

                // Derive a project name from the remote URL
                // e.g. "git@github.com:user/repo.git" -> "repo"
                //      "https://github.com/user/repo.git" -> "repo"
                const projectName = remoteUrl
                    .split("/")
                    .pop()!
                    .replace(/\.git$/, "");

                const projectDir = join(PROJECTS_DIR, projectName);
                const referenceDir = join(projectDir, "reference");

                // Create project folder structure
                await mkdir(referenceDir, { recursive: true });

                // Clone into the reference directory
                const result =
                    await Bun.$`git clone ${remoteUrl} ${referenceDir}`.quiet();

                if (result.exitCode !== 0) {
                    return Response.json(
                        {
                            error: "git clone failed",
                            details: result.stderr.toString(),
                        },
                        { status: 500 }
                    );
                }

                console.log(`Cloned ${remoteUrl} into ${referenceDir}`);

                return Response.json({
                    ok: true,
                    projectName,
                    projectDir,
                    referenceDir,
                });
            },
        },
    },
});

console.log("Server running on http://localhost:3000");
