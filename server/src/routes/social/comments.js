const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Get comments for a post
router.get('/post/:postId', authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;
    
    const comments = await prisma.comment.findMany({
      where: {
        postId,
        parentId: null // Only top-level comments
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            profileImage: true
          }
        },
        likes: {
          where: { userId },
          select: { id: true }
        },
        replies: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                profileImage: true
              }
            },
            likes: {
              where: { userId },
              select: { id: true }
            },
            _count: {
              select: { likes: true }
            }
          },
          orderBy: { createdAt: 'asc' }
        },
        _count: {
          select: { likes: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    // Format comments with like status
    const formattedComments = comments.map(comment => ({
      ...comment,
      isLiked: comment.likes.length > 0,
      likes: comment._count.likes,
      replies: comment.replies.map(reply => ({
        ...reply,
        isLiked: reply.likes.length > 0,
        likes: reply._count.likes
      }))
    }));
    
    res.json({
      success: true,
      data: {
        comments: formattedComments,
        totalComments: comments.length
      }
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch comments' });
  }
});

// Add comment to post
router.post('/post/:postId', authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Comment content is required' 
      });
    }
    
    const comment = await prisma.comment.create({
      data: {
        userId,
        postId,
        content: content.trim()
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            profileImage: true
          }
        },
        _count: {
          select: { likes: true }
        }
      }
    });
    
    // Create notification for post owner
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { userId: true }
    });
    
    if (post.userId !== userId) {
      await prisma.notification.create({
        data: {
          userId: post.userId,
          fromUserId: userId,
          type: 'comment',
          title: 'New Comment',
          message: `${req.user.name} commented on your post`,
          postId,
          commentId: comment.id
        }
      });
    }
    
    res.status(201).json({
      success: true,
      data: { 
        comment: {
          ...comment,
          isLiked: false,
          likes: 0,
          replies: []
        }
      }
    });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ success: false, error: 'Failed to create comment' });
  }
});

// Reply to comment
router.post('/:commentId/reply', authenticateToken, async (req, res) => {
  try {
    const { commentId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Reply content is required' 
      });
    }
    
    // Get parent comment to find post
    const parentComment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { postId: true, userId: true }
    });
    
    if (!parentComment) {
      return res.status(404).json({ 
        success: false, 
        error: 'Comment not found' 
      });
    }
    
    const reply = await prisma.comment.create({
      data: {
        userId,
        postId: parentComment.postId,
        parentId: commentId,
        content: content.trim()
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            profileImage: true
          }
        },
        _count: {
          select: { likes: true }
        }
      }
    });
    
    // Create notification for comment owner
    if (parentComment.userId !== userId) {
      await prisma.notification.create({
        data: {
          userId: parentComment.userId,
          fromUserId: userId,
          type: 'comment',
          title: 'New Reply',
          message: `${req.user.name} replied to your comment`,
          postId: parentComment.postId,
          commentId: reply.id
        }
      });
    }
    
    res.status(201).json({
      success: true,
      data: { 
        reply: {
          ...reply,
          isLiked: false,
          likes: 0
        }
      }
    });
  } catch (error) {
    console.error('Error creating reply:', error);
    res.status(500).json({ success: false, error: 'Failed to create reply' });
  }
});

// Like/unlike comment
router.post('/:commentId/like', authenticateToken, async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user.id;
    
    // Check if already liked
    const existingLike = await prisma.commentLike.findUnique({
      where: {
        userId_commentId: { userId, commentId }
      }
    });
    
    if (existingLike) {
      // Unlike
      await prisma.commentLike.delete({
        where: { id: existingLike.id }
      });
    } else {
      // Like
      await prisma.commentLike.create({
        data: { userId, commentId }
      });
      
      // Create notification for comment owner
      const comment = await prisma.comment.findUnique({
        where: { id: commentId },
        select: { userId: true }
      });
      
      if (comment.userId !== userId) {
        await prisma.notification.create({
          data: {
            userId: comment.userId,
            fromUserId: userId,
            type: 'like',
            title: 'Comment Liked',
            message: `${req.user.name} liked your comment`,
            commentId
          }
        });
      }
    }
    
    // Get updated like count
    const likesCount = await prisma.commentLike.count({
      where: { commentId }
    });
    
    res.json({
      success: true,
      data: {
        isLiked: !existingLike,
        likesCount
      }
    });
  } catch (error) {
    console.error('Error toggling comment like:', error);
    res.status(500).json({ success: false, error: 'Failed to toggle like' });
  }
});

// Delete comment
router.delete('/:commentId', authenticateToken, async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user.id;
    
    // Check if user owns the comment
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { userId: true }
    });
    
    if (!comment) {
      return res.status(404).json({ 
        success: false, 
        error: 'Comment not found' 
      });
    }
    
    if (comment.userId !== userId) {
      return res.status(403).json({ 
        success: false, 
        error: 'You can only delete your own comments' 
      });
    }
    
    // Delete comment and all its replies (cascade)
    await prisma.comment.delete({
      where: { id: commentId }
    });
    
    res.json({
      success: true,
      data: { message: 'Comment deleted successfully' }
    });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ success: false, error: 'Failed to delete comment' });
  }
});

module.exports = router;