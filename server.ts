import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

function projectNameFromUrl(remoteUrl: string): string {
    return remoteUrl
        .split("/")
        .pop()!
        .replace(/\.git$/, "");
}

const PROJECTS_DIR = join(import.meta.dir, ".projects");

Bun.serve({
    port: 3000,
    routes: {
        "/healthz": new Response("ok"),
        "/api/project/init": {
            POST: async (req) => {
                const { remoteUrl } = (await req.json()) as {
                    remoteUrl: unknown;
                };

                if (!remoteUrl || typeof remoteUrl !== "string") {
                    return Response.json(
                        { error: "remoteUrl is required" },
                        { status: 400 }
                    );
                }

                const projectName = projectNameFromUrl(remoteUrl);
                const projectDir = join(PROJECTS_DIR, projectName);
                const referenceDir = join(projectDir, "reference");

                await mkdir(referenceDir, { recursive: true });

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
        "/api/project/cleanup": {
            POST: async (req) => {
                const { remoteUrl } = (await req.json()) as {
                    remoteUrl: unknown;
                };

                if (!remoteUrl || typeof remoteUrl !== "string") {
                    return Response.json(
                        { error: "remoteUrl is required" },
                        { status: 400 }
                    );
                }

                const projectName = projectNameFromUrl(remoteUrl);
                const projectDir = join(PROJECTS_DIR, projectName);

                // Check if the project directory exists
                const exists = await Bun.file(
                    join(projectDir, "reference/.git/HEAD")
                ).exists();

                if (!exists) {
                    return Response.json(
                        { error: "project not found", projectName },
                        { status: 404 }
                    );
                }

                await rm(projectDir, { recursive: true, force: true });
                console.log(`Deleted project ${projectName} at ${projectDir}`);

                return Response.json({
                    ok: true,
                    projectName,
                    deleted: projectDir,
                });
            },
        },
    },
});

console.log("Server running on http://localhost:3000");
