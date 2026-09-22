import { describe, expect, it, type Mock, mock } from "bun:test";

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createLogger } from "winston";

import { DomainError } from "../../errors/domain-error";
import { NOT_FOUND, UNAUTHORIZED } from "../../errors/error-codes";
import { createVisioRoomController } from "./controller";
import { VisioRoomUnavailableError } from "./errors";
import { VisioService } from "./service";
import type { VisioDeps, VisioRequest, VisioRoom } from "./types";

const silentLogger = createLogger({
  silent: true,
});

const room: VisioRoom = {
  url: "https://visio.example.com/abc-defg-hij",
};

interface Setup {
  service: VisioService;
  deps: VisioDeps;
  createRoom: Mock<VisioService["createRoom"]>;
  resolveEmail: Mock<VisioDeps["resolveEmail"]>;
}

const authenticate: RequestHandler = (_req: Request, _res: Response, next: NextFunction): void => next();

const setup = (email: string | null): Setup => {
  const service = new VisioService(
    {
      enabled: false,
      timeout_ms: 1000,
    },
    silentLogger,
  );
  const createRoom = mock(() => Promise.resolve(room));
  service.createRoom = createRoom;

  const resolveEmail = mock(() => Promise.resolve(email));

  return {
    service,
    deps: {
      authenticate,
      resolveEmail,
    },
    createRoom,
    resolveEmail,
  };
};

const requestOf = (userId?: string): VisioRequest =>
  ({
    userId,
  }) as VisioRequest;

describe("createVisioRoomController", () => {
  it("should create the room with the email of the authenticated user", async () => {
    // Arrange
    const { service, deps, createRoom, resolveEmail } = setup("dwho@example.com");
    const req = requestOf("@dwho:example.com");

    // Act
    const result = await createVisioRoomController(service, deps, req, silentLogger);

    // Assert
    expect(result).toEqual(room);
    expect(resolveEmail).toHaveBeenCalledWith(req);
    expect(createRoom).toHaveBeenCalledWith("dwho@example.com");
  });

  it.each([
    null,
    "",
  ])("should throw NOT_FOUND when the user has no email (%p)", async (email) => {
    // Arrange
    const { service, deps, createRoom } = setup(email);

    // Act
    const error = await createVisioRoomController(service, deps, requestOf("@dwho:example.com"), silentLogger).catch(
      (err: unknown) => err,
    );

    // Assert
    expect(error).toBeInstanceOf(VisioRoomUnavailableError);
    expect((error as VisioRoomUnavailableError).code).toBe(NOT_FOUND);
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("should throw UNAUTHORIZED when the request carries no user", async () => {
    // Arrange
    const { service, deps, resolveEmail } = setup("dwho@example.com");

    // Act
    const error = await createVisioRoomController(service, deps, requestOf(), silentLogger).catch(
      (err: unknown) => err,
    );

    // Assert
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(UNAUTHORIZED);
    expect(resolveEmail).not.toHaveBeenCalled();
  });
});
